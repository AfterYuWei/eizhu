//! Local, tracked SSH forwarding. Each running tunnel owns an independent route.
use super::{
    authentication::AuthenticationCoordinator,
    transport::{
        connect_forwarding_route, AuthenticationPrompt, AuthenticationRequest,
        AuthenticationResponder, ConnectedRoute, HostKeyVerifier,
    },
    tunnel_repository::TunnelRepository,
    SessionEventSink,
};
use crate::{app::RECONNECT_BACKOFF_SECONDS, error::CommandError, profile::ProfileService};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, Semaphore},
    task::{JoinHandle, JoinSet},
    time::{timeout, Duration},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TunnelKind {
    Local,
    Remote,
    Dynamic,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TunnelConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub profile_id: String,
    pub kind: TunnelKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}
impl TunnelConfig {
    fn validate(&self) -> Result<(), CommandError> {
        if self.name.trim().is_empty()
            || self.name.len() > 256
            || self.profile_id.len() > 128
            || self.id.len() > 128
        {
            return Err(CommandError::new("VALIDATION", "隧道名称或服务器配置非法"));
        }
        self.bind_address()?;
        if self.kind == TunnelKind::Dynamic {
            return Ok(());
        }
        if self.target_port == 0
            || self.target_host.is_empty()
            || self.target_host.len() > 253
            || self
                .target_host
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || (self.target_host.parse::<IpAddr>().is_err()
                && !self
                    .target_host
                    .chars()
                    .all(|c| c.is_alphanumeric() || "-._".contains(c)))
        {
            return Err(CommandError::new("VALIDATION", "目标地址或端口非法"));
        }
        Ok(())
    }
    fn bind_address(&self) -> Result<SocketAddr, CommandError> {
        let ip = if self.bind_host == "localhost" {
            "127.0.0.1".parse::<IpAddr>().unwrap()
        } else {
            self.bind_host
                .parse()
                .map_err(|_| CommandError::new("VALIDATION", "监听地址必须是回环 IP"))?
        };
        if !ip.is_loopback() {
            return Err(CommandError::new("VALIDATION", "监听地址只允许回环地址"));
        }
        Ok(SocketAddr::new(ip, self.bind_port))
    }
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct TunnelStatus {
    pub id: String,
    pub status: String,
    pub generation: u64,
    pub revision: u64,
    pub bound_port: Option<u16>,
    pub active_connections: usize,
    pub retry_attempt: usize,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}
struct Tracked {
    cancel: CancellationToken,
    job: JoinHandle<()>,
}
#[derive(Clone)]
pub(crate) struct TunnelService {
    profiles: ProfileService,
    repository: TunnelRepository,
    events: Arc<dyn SessionEventSink>,
    authentication: AuthenticationCoordinator,
    states: Arc<StdMutex<HashMap<String, TunnelStatus>>>,
    tasks: Arc<Mutex<HashMap<String, Tracked>>>,
    operations: Arc<Mutex<()>>,
    accepting: Arc<AtomicBool>,
}
#[derive(Clone)]
struct TunnelAuthentication {
    id: String,
    profile: ProfileService,
    coordinator: AuthenticationCoordinator,
    events: Arc<dyn SessionEventSink>,
    cancel: CancellationToken,
    trusted_once: Arc<StdMutex<HashSet<String>>>,
}
impl TunnelAuthentication {
    fn emit(&self, kind: &str, payload: Value) {
        self.events
            .emit_session(json!({"session_id":self.id,"type":kind,"payload":payload}));
    }
}
impl AuthenticationResponder for TunnelAuthentication {
    fn respond<'a>(
        &'a self,
        request: AuthenticationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, String>> + Send + 'a>> {
        Box::pin(async move {
            self.coordinator
                .request(request, &self.cancel, |payload| {
                    self.emit(
                        if payload["closed"] == true {
                            "tunnel_auth_closed"
                        } else {
                            "tunnel_auth_request"
                        },
                        payload,
                    )
                })
                .await
        })
    }
}
impl HostKeyVerifier for TunnelAuthentication {
    fn verify<'a>(
        &'a self,
        profile_id: &'a str,
        profile_name: &'a str,
        known: &'a str,
        current: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            let identity = format!("{profile_id}:{current}");
            if (!known.is_empty() && known == current)
                || self
                    .trusted_once
                    .lock()
                    .expect("trusted tunnel keys")
                    .contains(&identity)
            {
                return true;
            }
            let request = AuthenticationRequest {
                profile_id: profile_id.into(),
                name: profile_name.into(),
                instructions: String::new(),
                prompts: vec![
                    AuthenticationPrompt {
                        prompt: "decision".into(),
                        echo: true,
                    },
                    AuthenticationPrompt {
                        prompt: "fingerprint".into(),
                        echo: true,
                    },
                ],
            };
            let result = self
                .coordinator
                .request(request, &self.cancel, |mut payload| {
                    payload["fingerprint"] = json!(current);
                    payload["known_fingerprint"] = json!(known);
                    self.emit(
                        if payload["closed"] == true {
                            "tunnel_auth_closed"
                        } else {
                            "tunnel_host_key_request"
                        },
                        payload,
                    )
                })
                .await;
            match result {
                Ok(values) if values.len() == 2 && values[1] == current => match values[0].as_str()
                {
                    "trust_once" => {
                        self.trusted_once
                            .lock()
                            .expect("trusted tunnel keys")
                            .insert(identity);
                        true
                    }
                    "trust_permanently" => {
                        self.profile.persist_host_key(profile_id, current).is_ok()
                    }
                    _ => {
                        self.cancel.cancel();
                        false
                    }
                },
                _ => {
                    self.cancel.cancel();
                    false
                }
            }
        })
    }
}
impl TunnelService {
    pub(crate) fn new(
        profiles: ProfileService,
        repository: TunnelRepository,
        events: Arc<dyn SessionEventSink>,
        authentication: AuthenticationCoordinator,
    ) -> Self {
        Self {
            profiles,
            repository,
            events,
            authentication,
            states: Arc::new(StdMutex::new(HashMap::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::new(Mutex::new(())),
            accepting: Arc::new(AtomicBool::new(true)),
        }
    }
    fn ensure_active(&self) -> Result<(), CommandError> {
        if self.accepting.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(CommandError::new("WORKSPACE_CHANGED", "旧空间隧道已停止"))
        }
    }
    pub(crate) fn list(&self) -> Result<Vec<TunnelConfig>, CommandError> {
        self.ensure_active()?;
        self.repository.list()
    }
    pub(crate) fn statuses(&self) -> Result<Vec<TunnelStatus>, CommandError> {
        let mut states = self.states.lock().expect("tunnel states");
        Ok(self
            .list()?
            .into_iter()
            .map(|c| {
                states
                    .entry(c.id.clone())
                    .or_insert(TunnelStatus {
                        id: c.id,
                        status: "stopped".into(),
                        generation: 0,
                        revision: 0,
                        bound_port: None,
                        active_connections: 0,
                        retry_attempt: 0,
                        error_code: None,
                        error_message: None,
                    })
                    .clone()
            })
            .collect())
    }
    pub(crate) async fn save(
        &self,
        mut config: TunnelConfig,
    ) -> Result<TunnelConfig, CommandError> {
        let _operation = self.operations.lock().await;
        self.ensure_active()?;
        config.validate()?;
        self.profiles.get(&config.profile_id)?;
        if config.id.is_empty() {
            config.id = uuid::Uuid::new_v4().to_string()
        } else {
            self.repository.get(&config.id)?;
        }
        if self
            .tasks
            .lock()
            .await
            .get(&config.id)
            .is_some_and(|t| !t.job.is_finished())
        {
            return Err(CommandError::new(
                "TUNNEL_RUNNING",
                "请先停止隧道再修改配置",
            ));
        }
        self.repository.save(&config)?;
        Ok(config)
    }
    pub(crate) async fn remove(&self, id: &str) -> Result<(), CommandError> {
        let _operation = self.operations.lock().await;
        self.ensure_active()?;
        self.stop_inner(id).await;
        self.repository.remove(id)
    }
    fn update(&self, id: &str, change: impl FnOnce(&mut TunnelStatus)) {
        let status = {
            let mut states = self.states.lock().expect("tunnel states");
            let state = states.get_mut(id).expect("tracked tunnel");
            change(state);
            state.revision += 1;
            state.clone()
        };
        self.events
            .emit_session(json!({"session_id":id,"type":"tunnel_status","payload":status}));
    }
    pub(crate) async fn start(&self, id: &str) -> Result<TunnelStatus, CommandError> {
        let _operation = self.operations.lock().await;
        self.ensure_active()?;
        if self
            .tasks
            .lock()
            .await
            .get(id)
            .is_some_and(|t| !t.job.is_finished())
        {
            return Err(CommandError::new("TUNNEL_RUNNING", "隧道已启动"));
        }
        self.stop_inner(id).await;
        let config = self.repository.get(id)?;
        config.validate()?;
        self.profiles.resolve_connection(&config.profile_id)?;
        let listener = if config.kind != TunnelKind::Remote {
            Some(
                TcpListener::bind(config.bind_address()?)
                    .await
                    .map_err(|e| CommandError::new("TUNNEL_BIND", format!("监听端口失败：{e}")))?,
            )
        } else {
            None
        };
        let bound_port = listener
            .as_ref()
            .map(|listener| listener.local_addr().map(|a| a.port()))
            .transpose()
            .map_err(CommandError::database)?;
        let generation = self
            .states
            .lock()
            .expect("tunnel states")
            .get(id)
            .map(|s| s.generation + 1)
            .unwrap_or(1);
        let state = TunnelStatus {
            id: id.into(),
            status: "connecting".into(),
            generation,
            revision: 0,
            bound_port,
            active_connections: 0,
            retry_attempt: 0,
            error_code: None,
            error_message: None,
        };
        self.states
            .lock()
            .expect("tunnel states")
            .insert(id.into(), state.clone());
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        let service = self.clone();
        let owned_id = id.to_owned();
        let job = tokio::spawn(async move {
            service.run(config, listener, token).await;
        });
        self.tasks
            .lock()
            .await
            .insert(owned_id, Tracked { cancel, job });
        self.events
            .emit_session(json!({"session_id":id,"type":"tunnel_status","payload":state}));
        Ok(state)
    }
    pub(crate) async fn stop(&self, id: &str) -> Result<(), CommandError> {
        let _operation = self.operations.lock().await;
        self.stop_inner(id).await;
        Ok(())
    }
    async fn stop_inner(&self, id: &str) {
        if let Some(task) = self.tasks.lock().await.remove(id) {
            task.cancel.cancel();
            let _ = task.job.await;
        }
        if self.states.lock().expect("tunnel states").contains_key(id) {
            self.update(id, |s| {
                s.status = "stopped".into();
                s.bound_port = None;
                s.active_connections = 0;
            });
        }
    }
    pub(crate) async fn shutdown(&self) {
        let _operation = self.operations.lock().await;
        self.accepting.store(false, Ordering::Release);
        let ids = self.tasks.lock().await.keys().cloned().collect::<Vec<_>>();
        for id in ids {
            self.stop_inner(&id).await;
        }
    }
    async fn run(
        &self,
        config: TunnelConfig,
        listener: Option<TcpListener>,
        cancel: CancellationToken,
    ) {
        let trusted_once = Arc::new(StdMutex::new(HashSet::new()));
        for attempt in 0..=10 {
            if cancel.is_cancelled() {
                break;
            }
            let resolved = match self.profiles.resolve_connection(&config.profile_id) {
                Ok(p) => p,
                Err(e) => {
                    self.update(&config.id, |s| {
                        s.status = "failed".into();
                        s.error_code = Some("CREDENTIAL".into());
                        s.error_message = Some(e.to_string());
                        s.bound_port = None;
                    });
                    return;
                }
            };
            self.update(&config.id, |s| {
                s.status = if attempt == 0 {
                    "connecting"
                } else {
                    "reconnecting"
                }
                .into();
                s.retry_attempt = attempt;
            });
            let scope = super::connection_scope::ConnectionScope::new();
            let auth_cancel = cancel.child_token();
            let auth = Arc::new(TunnelAuthentication {
                id: config.id.clone(),
                profile: self.profiles.clone(),
                coordinator: self.authentication.clone(),
                events: self.events.clone(),
                cancel: auth_cancel.clone(),
                trusted_once: trusted_once.clone(),
            });
            let (registration, incoming) = super::forwarding::ForwardingRegistration::new();
            let route = {
                let connecting = connect_forwarding_route(
                    resolved,
                    auth.clone(),
                    auth,
                    registration.clone(),
                    scope.clone(),
                );
                tokio::pin!(connecting);
                loop {
                    tokio::select! {
                        _ = cancel.cancelled() => break Err("隧道已取消".into()),
                        result = &mut connecting => break result,
                        accepted = accept_local(listener.as_ref()) => { if let Ok((stream, _)) = accepted { drop(stream); } },
                    }
                }
            };
            let outcome = match route {
                Ok(route) => {
                    if let Some(listener) = &listener {
                        self.update(&config.id, |s| {
                            s.status = "running".into();
                            s.error_code = None;
                            s.error_message = None;
                        });
                        self.serve(&config, listener, route, &cancel).await
                    } else {
                        self.serve_remote(&config, route, registration, incoming, &cancel)
                            .await
                    }
                }
                Err(e) => Err(e.to_string()),
            };
            let rejected = auth_cancel.is_cancelled();
            scope.finish().await;
            if cancel.is_cancelled() || rejected {
                break;
            }
            let error = outcome.err().unwrap_or_else(|| "SSH 连接已断开".into());
            self.update(&config.id, |s| {
                s.status = "reconnecting".into();
                s.error_code = Some(
                    if error.starts_with("远端监听") {
                        "TUNNEL_REMOTE_REQUEST"
                    } else {
                        "TUNNEL_DISCONNECTED"
                    }
                    .into(),
                );
                if config.kind == TunnelKind::Remote {
                    s.bound_port = None;
                }
                s.error_message = Some(error);
            });
            if attempt == 10 {
                self.update(&config.id, |s| {
                    s.status = "failed".into();
                    s.bound_port = None;
                    s.active_connections = 0;
                });
                return;
            }
            let delay = RECONNECT_BACKOFF_SECONDS[attempt.min(RECONNECT_BACKOFF_SECONDS.len() - 1)];
            let waiting = tokio::time::sleep(Duration::from_secs(delay));
            tokio::pin!(waiting);
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = &mut waiting => break,
                    accepted = accept_local(listener.as_ref()) => { if let Ok((stream, _)) = accepted { drop(stream); } },
                }
            }
        }
        self.update(&config.id, |s| {
            s.status = "stopped".into();
            s.active_connections = 0;
            s.bound_port = None;
        });
    }

    async fn serve_remote(
        &self,
        config: &TunnelConfig,
        route: ConnectedRoute,
        registration: super::forwarding::ForwardingRegistration,
        mut incoming: tokio::sync::mpsc::Receiver<super::forwarding::ForwardedChannel>,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        let address = config.bind_address().map_err(|e| e.to_string())?;
        let host = address.ip().to_string();
        let request = tokio::select! {
            _ = cancel.cancelled() => Err("远端监听已取消".to_string()),
            result = timeout(Duration::from_secs(30), route.handle.tcpip_forward(host.clone(), u32::from(address.port()))) => {
                result.map_err(|_| "远端监听请求超时".to_string()).and_then(|r| r.map_err(|e| format!("远端监听被拒绝：{e}")))
            }
        };
        let port = match request.and_then(|port| {
            u16::try_from(port)
                .ok()
                .filter(|p| *p != 0)
                .ok_or_else(|| "远端监听返回非法端口".to_string())
        }) {
            Ok(port) => port,
            Err(error) => {
                route.shutdown().await;
                return Err(error);
            }
        };
        registration.set_address(Some(SocketAddr::new(address.ip(), port)));
        self.update(&config.id, |s| {
            s.status = "running".into();
            s.bound_port = Some(port);
            s.error_code = None;
            s.error_message = None;
        });
        let child = cancel.child_token();
        let mut relays = JoinSet::new();
        let mut health = tokio::time::interval(Duration::from_secs(3));
        health.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let outcome = loop {
            tokio::select! {
                _ = cancel.cancelled() => break Ok(()),
                _ = health.tick() => { if route.handle.is_closed() { break Err("SSH 连接已关闭".into()); } },
                finished = relays.join_next(), if !relays.is_empty() => {
                    if let Some(Ok(Err(error))) = finished { self.update(&config.id, |s| { s.error_code=Some("TUNNEL_RELAY".into()); s.error_message=Some(error); }); }
                    self.update(&config.id, |s| s.active_connections=relays.len());
                },
                forwarded = incoming.recv() => {
                    let Some(forwarded) = forwarded else { break Err("远端转发接收通道已关闭".into()) };
                    let relay_config = config.clone(); let token = child.clone();
                    relays.spawn(async move {
                        let _permit = forwarded.permit;
                        tokio::select! { _=token.cancelled()=>Ok(()), result=remote_relay(forwarded.channel, &relay_config)=>result }
                    });
                    self.update(&config.id, |s| s.active_connections=relays.len());
                }
            }
        };
        registration.set_address(None);
        incoming.close();
        child.cancel();
        while relays.join_next().await.is_some() {}
        drop(incoming);
        self.update(&config.id, |s| s.active_connections = 0);
        let cancelled = timeout(
            Duration::from_secs(5),
            route.handle.cancel_tcpip_forward(host, u32::from(port)),
        )
        .await;
        route.shutdown().await;
        if !matches!(cancelled, Ok(Ok(()))) {
            return Err("远端监听取消失败；SSH 连接已关闭".into());
        }
        outcome
    }
    async fn serve(
        &self,
        config: &TunnelConfig,
        listener: &TcpListener,
        route: ConnectedRoute,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        let route = Arc::new(route);
        let child = cancel.child_token();
        let permits = Arc::new(Semaphore::new(32));
        let mut relays = JoinSet::new();
        let mut health = tokio::time::interval(Duration::from_secs(3));
        health.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let outcome = loop {
            tokio::select! {
                _=cancel.cancelled()=>break Ok(()),
                _=health.tick()=>{if route.handle.is_closed(){break Err("SSH 连接已关闭".into())}},
                finished=relays.join_next(),if !relays.is_empty()=>{if let Some(Ok(Err(error)))=finished {self.update(&config.id,|s|{s.error_code=Some("TUNNEL_RELAY".into());s.error_message=Some(error);});}self.update(&config.id,|s|s.active_connections=relays.len());},
                accepted=listener.accept()=>match accepted {
                    Ok((stream,peer))=>{
                        let Ok(permit)=permits.clone().try_acquire_owned() else {drop(stream);continue};
                        let route=route.clone();let relay_config=config.clone();let token=child.clone();
                        relays.spawn(async move {let _permit=permit;tokio::select! {_=token.cancelled()=>Ok(()),result=local_relay(stream,peer,&route,&relay_config)=>result}});
                        self.update(&config.id,|s|s.active_connections=relays.len());
                    },
                    Err(e)=>break Err(e.to_string()),
                }
            }
        };
        child.cancel();
        while relays.join_next().await.is_some() {}
        self.update(&config.id, |s| s.active_connections = 0);
        if let Ok(route) = Arc::try_unwrap(route) {
            route.shutdown().await;
        }
        outcome
    }
}
async fn accept_local(listener: Option<&TcpListener>) -> std::io::Result<(TcpStream, SocketAddr)> {
    match listener {
        Some(listener) => listener.accept().await,
        None => std::future::pending().await,
    }
}
async fn remote_relay(
    channel: russh::Channel<russh::client::Msg>,
    config: &TunnelConfig,
) -> Result<(), String> {
    let mut stream = timeout(
        Duration::from_secs(30),
        TcpStream::connect((config.target_host.as_str(), config.target_port)),
    )
    .await
    .map_err(|_| "本地目标连接超时".to_string())?
    .map_err(|e| e.to_string())?;
    let mut remote = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut remote)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn local_relay(
    mut stream: TcpStream,
    peer: SocketAddr,
    route: &ConnectedRoute,
    config: &TunnelConfig,
) -> Result<(), String> {
    if config.kind == TunnelKind::Dynamic {
        return super::socks::relay(stream, peer, route).await;
    }
    let channel = timeout(
        Duration::from_secs(30),
        route.handle.channel_open_direct_tcpip(
            config.target_host.clone(),
            u32::from(config.target_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        ),
    )
    .await
    .map_err(|_| "转发通道超时".to_string())?
    .map_err(|e| e.to_string())?;
    let mut remote = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut remote)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests;
