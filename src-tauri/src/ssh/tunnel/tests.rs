use super::*;
use crate::{
    audit::AuditRepository,
    infrastructure::database::Database,
    profile::{ProfileCreateRequest, ProfileService},
    vault::{Encryptor, VaultService},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
struct Events;
impl SessionEventSink for Events {
    fn emit_session(&self, _: Value) {}
}
struct ForwardServer {
    relays: Arc<StdMutex<Vec<JoinHandle<()>>>>,
    listeners: HashMap<u32, (CancellationToken, tokio::sync::oneshot::Receiver<()>)>,
    remote_cancels: Arc<std::sync::atomic::AtomicUsize>,
    remote_reject: Arc<AtomicBool>,
    wrong_forward: Arc<AtomicBool>,
}
impl Drop for ForwardServer {
    fn drop(&mut self) {
        for (cancel, _) in self.listeners.values() {
            cancel.cancel();
        }
    }
}

impl russh::server::Handler for ForwardServer {
    type Error = russh::Error;
    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> Result<russh::server::Auth, Self::Error> {
        assert_eq!((user, password), ("test", "secret"));
        Ok(russh::server::Auth::Accept)
    }
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        host: &str,
        port: u32,
        _origin: &str,
        _origin_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        assert_eq!(host, "localhost");
        let socket = TcpStream::connect((host, port as u16)).await.unwrap();
        reply.accept().await;
        self.relays.lock().unwrap().push(tokio::spawn(async move {
            let mut socket = socket;
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
        }));
        Ok(())
    }
    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut russh::server::Session,
    ) -> Result<bool, Self::Error> {
        if self.remote_reject.load(Ordering::Acquire) {
            return Ok(false);
        }
        assert!(address.parse::<IpAddr>().unwrap().is_loopback());
        let Ok(listener) = TcpListener::bind((address, *port as u16)).await else {
            return Ok(false);
        };
        *port = u32::from(listener.local_addr().unwrap().port());
        let allocated = *port;
        let host = address.to_string();
        let handle = session.handle();
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
        self.listeners.insert(allocated, (cancel, closed_rx));
        let wrong = self.wrong_forward.clone();
        self.relays.lock().unwrap().push(tokio::spawn(async move {
            let mut workers = JoinSet::new();
            loop {
                tokio::select! {
                    _ = token.cancelled() => break,
                    accepted = listener.accept() => {
                        let Ok((mut socket, peer)) = accepted else { break };
                        let handle = handle.clone();
                        let host = if wrong.load(Ordering::Acquire) { "0.0.0.0".to_string() } else { host.clone() };
                        workers.spawn(async move {
                            if let Ok(channel) = handle.channel_open_forwarded_tcpip(host, allocated, peer.ip().to_string(), u32::from(peer.port())).await {
                                let mut remote = channel.into_stream(); let _ = tokio::io::copy_bidirectional(&mut socket, &mut remote).await;
                            }
                        });
                    },
                    _ = workers.join_next(), if !workers.is_empty() => {},
                }
            }
            workers.shutdown().await;
            drop(listener);
            let _ = closed_tx.send(());
        }));
        Ok(true)
    }
    async fn cancel_tcpip_forward(
        &mut self,
        _address: &str,
        port: u32,
        _session: &mut russh::server::Session,
    ) -> Result<bool, Self::Error> {
        if let Some((cancel, closed)) = self.listeners.remove(&port) {
            cancel.cancel();
            let _ = closed.await;
            self.remote_cancels.fetch_add(1, Ordering::AcqRel);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
struct Fixture {
    _directory: tempfile::TempDir,
    database: Database,
    service: TunnelService,
    profile_id: String,
    target_port: u16,
    cancel: CancellationToken,
    remote_cancels: Arc<std::sync::atomic::AtomicUsize>,
    remote_reject: Arc<AtomicBool>,
    wrong_forward: Arc<AtomicBool>,
    server: JoinHandle<()>,
    echo: JoinHandle<()>,
    relays: Arc<StdMutex<Vec<JoinHandle<()>>>>,
}
impl Fixture {
    async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::initialize(directory.path().join("eizhu.db")).unwrap();
        let encryptor = Encryptor::load_or_create(directory.path().join("key")).unwrap();
        let audit = AuditRepository::new(database.clone());
        let vault = VaultService::new(database.clone(), encryptor.clone(), audit);
        let profiles =
            ProfileService::initialize(database.clone(), encryptor.clone(), vault).unwrap();
        let key = ssh_key::PrivateKey::random(&mut rand_core::OsRng, ssh_key::Algorithm::Ed25519)
            .unwrap();
        let key =
            russh::keys::decode_secret_key(&key.to_openssh(ssh_key::LineEnding::LF).unwrap(), None)
                .unwrap();
        let fingerprint = key
            .public_key()
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string();
        let config = Arc::new(russh::server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::ZERO,
            ..Default::default()
        });
        let ssh = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ssh_port = ssh.local_addr().unwrap().port();
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_port = target.local_addr().unwrap().port();
        let request:ProfileCreateRequest=serde_json::from_value(json!({"name":"测试 SSH","host":"127.0.0.1","port":ssh_port,"username":"test","auth_type":"password","password":"secret"})).unwrap();
        let profile_id = profiles.create(request).unwrap().id;
        profiles
            .persist_host_key(&profile_id, &fingerprint)
            .unwrap();
        let relays = Arc::new(StdMutex::new(Vec::new()));
        let tasks = relays.clone();
        let remote_cancels = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let remote_reject = Arc::new(AtomicBool::new(false));
        let wrong_forward = Arc::new(AtomicBool::new(false));
        let cancels = remote_cancels.clone();
        let reject = remote_reject.clone();
        let wrong = wrong_forward.clone();
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        let server = tokio::spawn(async move {
            let mut jobs = JoinSet::new();
            loop {
                tokio::select! {_=token.cancelled()=>break,accepted=ssh.accept()=>{
                    let (stream,_)=accepted.unwrap();let handler=ForwardServer{relays:tasks.clone(),listeners:HashMap::new(),remote_cancels:cancels.clone(),remote_reject:reject.clone(),wrong_forward:wrong.clone()};let config=config.clone();
                    jobs.spawn(async move {if let Ok(session)=russh::server::run_stream(config,stream,handler).await {let _=session.await;}});
                }}
            }
            if timeout(Duration::from_secs(5), async {
                while jobs.join_next().await.is_some() {}
            })
            .await
            .is_err()
            {
                jobs.shutdown().await;
            }
        });
        let token = cancel.clone();
        let echo = tokio::spawn(async move {
            let mut jobs = JoinSet::new();
            loop {
                tokio::select! {_=token.cancelled()=>break,accepted=target.accept()=>{
                    let (mut stream,_)=accepted.unwrap();jobs.spawn(async move {let mut data=Vec::new();if stream.read_to_end(&mut data).await.is_ok(){let _=stream.write_all(&data).await;let _=stream.shutdown().await;}});
                }}
            }
            jobs.shutdown().await;
        });
        let service = TunnelService::new(
            profiles,
            TunnelRepository::new(database.clone(), encryptor),
            Arc::new(Events),
            AuthenticationCoordinator::default(),
        );
        Self {
            _directory: directory,
            database,
            service,
            profile_id,
            target_port,
            remote_cancels,
            remote_reject,
            wrong_forward,
            cancel,
            server,
            echo,
            relays,
        }
    }
    fn config(&self) -> TunnelConfig {
        TunnelConfig {
            id: String::new(),
            name: "私有转发".into(),
            profile_id: self.profile_id.clone(),
            kind: TunnelKind::Local,
            bind_host: "127.0.0.1".into(),
            bind_port: 0,
            target_host: "localhost".into(),
            target_port: self.target_port,
        }
    }
    async fn wait(&self, id: &str, predicate: impl Fn(&TunnelStatus) -> bool) -> TunnelStatus {
        timeout(Duration::from_secs(8), async {
            loop {
                let state = self
                    .service
                    .statuses()
                    .unwrap()
                    .into_iter()
                    .find(|s| s.id == id)
                    .unwrap();
                if predicate(&state) {
                    return state;
                };
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
    async fn close(self) {
        self.service.shutdown().await;
        self.cancel.cancel();
        self.server.await.unwrap();
        self.echo.await.unwrap();
        let jobs = self.relays.lock().unwrap().drain(..).collect::<Vec<_>>();
        for job in jobs {
            timeout(Duration::from_secs(5), job).await.unwrap().unwrap();
        }
    }
}
#[tokio::test]
async fn local_forward_round_trip_half_close_and_stop_release_port() {
    let f = Fixture::new().await;
    let config = f.service.save(f.config()).await.unwrap();
    let state = f.service.start(&config.id).await.unwrap();
    let port = state.bound_port.unwrap();
    f.wait(&config.id, |s| s.status == "running").await;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let data = "中文往返".repeat(8192).into_bytes();
    stream.write_all(&data).await.unwrap();
    stream.shutdown().await.unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(8), stream.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response, data);
    assert!(f.service.start(&config.id).await.is_err());
    f.service.stop(&config.id).await.unwrap();
    assert_eq!(f.service.statuses().unwrap()[0].status, "stopped");
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    drop(listener);
    let reopened = TunnelService::new(
        f.service.profiles.clone(),
        f.service.repository.clone(),
        Arc::new(Events),
        AuthenticationCoordinator::default(),
    );
    assert_eq!(reopened.statuses().unwrap()[0].status, "stopped");
    let plaintext: String = f
        .database
        .connect()
        .unwrap()
        .query_row("SELECT payload FROM local_tunnels", [], |r| r.get(0))
        .unwrap();
    assert!(!plaintext.contains("私有转发"));
    assert!(!plaintext.contains("localhost"));
    let queue: i64 = f
        .database
        .connect()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM realtime_outbox WHERE item_type='tunnel'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(queue, 0);
    f.close().await;
}
#[tokio::test]
async fn loopback_validation_busy_ports_connection_limit_and_workspace_shutdown() {
    let f = Fixture::new().await;
    let mut invalid = f.config();
    invalid.bind_host = "0.0.0.0".into();
    assert!(f.service.save(invalid).await.is_err());
    let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut config = f.config();
    config.bind_port = occupied.local_addr().unwrap().port();
    let config = f.service.save(config).await.unwrap();
    assert_eq!(
        f.service.start(&config.id).await.unwrap_err().code,
        "TUNNEL_BIND"
    );
    let config = f.service.save(f.config()).await.unwrap();
    let port = f
        .service
        .start(&config.id)
        .await
        .unwrap()
        .bound_port
        .unwrap();
    f.wait(&config.id, |s| s.status == "running").await;
    let mut streams = Vec::new();
    for _ in 0..32 {
        streams.push(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
    }
    f.wait(&config.id, |s| s.active_connections == 32).await;
    let mut extra = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), extra.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    f.service.shutdown().await;
    assert!(f.service.start(&config.id).await.is_err());
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    drop(listener);
    drop(streams);
    f.close().await;
}

#[tokio::test]
async fn remote_forward_round_trip_half_close_cancel_and_port_release() {
    let f = Fixture::new().await;
    let mut config = f.config();
    config.kind = TunnelKind::Remote;
    let config = f.service.save(config).await.unwrap();
    assert!(f
        .service
        .start(&config.id)
        .await
        .unwrap()
        .bound_port
        .is_none());
    let state = f.wait(&config.id, |s| s.status == "running").await;
    let port = state.bound_port.unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let data = "远端半关闭".repeat(8192).into_bytes();
    socket.write_all(&data).await.unwrap();
    socket.shutdown().await.unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(8), socket.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response, data);
    f.service.stop(&config.id).await.unwrap();
    assert_eq!(f.remote_cancels.load(Ordering::Acquire), 1);
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    drop(listener);
    f.close().await;
}
#[tokio::test]
async fn remote_rejection_and_unregistered_forward_channels_are_not_accepted() {
    let f = Fixture::new().await;
    f.remote_reject.store(true, Ordering::Release);
    let mut config = f.config();
    config.kind = TunnelKind::Remote;
    let config = f.service.save(config).await.unwrap();
    f.service.start(&config.id).await.unwrap();
    let state = f
        .wait(&config.id, |s| {
            s.error_code.as_deref() == Some("TUNNEL_REMOTE_REQUEST")
        })
        .await;
    assert!(state.bound_port.is_none());
    f.service.stop(&config.id).await.unwrap();
    f.remote_reject.store(false, Ordering::Release);
    f.wrong_forward.store(true, Ordering::Release);
    f.service.start(&config.id).await.unwrap();
    let port = f
        .wait(&config.id, |s| s.status == "running")
        .await
        .bound_port
        .unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), socket.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(f.service.statuses().unwrap()[0].active_connections, 0);
    f.close().await;
}

#[tokio::test]
async fn remote_busy_port_and_connection_limit_release_all_forwarding_workers() {
    let f = Fixture::new().await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut config = f.config();
    config.kind = TunnelKind::Remote;
    config.bind_port = listener.local_addr().unwrap().port();
    let config = f.service.save(config).await.unwrap();
    f.service.start(&config.id).await.unwrap();
    f.wait(&config.id, |s| {
        s.error_code.as_deref() == Some("TUNNEL_REMOTE_REQUEST")
    })
    .await;
    f.service.stop(&config.id).await.unwrap();
    drop(listener);
    let mut config = config;
    config.bind_port = 0;
    let config = f.service.save(config).await.unwrap();
    f.service.start(&config.id).await.unwrap();
    let port = f
        .wait(&config.id, |s| s.status == "running")
        .await
        .bound_port
        .unwrap();
    let mut streams = Vec::new();
    for _ in 0..32 {
        streams.push(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
    }
    f.wait(&config.id, |s| s.active_connections == 32).await;
    let mut extra = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), extra.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    f.service.stop(&config.id).await.unwrap();
    assert_eq!(f.remote_cancels.load(Ordering::Acquire), 1);
    assert_eq!(f.service.statuses().unwrap()[0].active_connections, 0);
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    drop(listener);
    drop(streams);
    f.close().await;
}
