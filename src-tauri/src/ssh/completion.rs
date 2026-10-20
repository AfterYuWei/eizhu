//! Fixed completion generators; callers cannot supply shell programs.
use super::{transport::ClientHandler, SshError};
use crate::error::CommandError;
use russh::{client, ChannelMsg};
use russh_sftp::{
    client::{error::Error as SftpError, RawSftpSession},
    protocol::StatusCode,
};
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CompletionParams {
    pub directory: Option<String>,
    pub namespace: Option<String>,
    pub resource: Option<String>,
    pub all: Option<bool>,
    pub prefix: Option<String>,
}
#[derive(Debug, Serialize)]
pub(crate) struct PathCandidate {
    pub name: String,
    pub is_dir: bool,
}
#[derive(Default)]
pub(super) struct CompletionResult {
    pub output: String,
    pub candidates: Vec<PathCandidate>,
    pub exit_code: i32,
}
const RESOURCES: &[&str] = &[
    "pods",
    "deployments",
    "services",
    "configmaps",
    "secrets",
    "nodes",
    "namespaces",
    "ingresses",
    "jobs",
    "cronjobs",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "persistentvolumeclaims",
    "serviceaccounts",
];
fn valid_path(path: &str) -> bool {
    path.len() <= 4096 && !path.chars().any(char::is_control)
}
pub(super) fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub(super) fn validate(
    id: &str,
    params: &CompletionParams,
    cwd: Option<&str>,
) -> Result<(), CommandError> {
    if cwd.is_some_and(|v| !valid_path(v))
        || params.directory.as_deref().is_some_and(|v| !valid_path(v))
        || params.prefix.as_deref().is_some_and(|v| !valid_path(v))
    {
        return Err(CommandError::new(
            "VALIDATION",
            "补全路径包含非法字符或过长",
        ));
    }
    template(id, params)
        .map(|_| ())
        .map_err(|error| CommandError::new("VALIDATION", error))
}
fn template(id: &str, p: &CompletionParams) -> Result<Option<String>, String> {
    let allowed = match id {
        "paths" => p.namespace.is_none() && p.resource.is_none() && p.all.is_none(),
        "docker-containers" => {
            p.directory.is_none()
                && p.namespace.is_none()
                && p.resource.is_none()
                && p.prefix.is_none()
        }
        "kubectl-resources" => p.directory.is_none() && p.all.is_none() && p.prefix.is_none(),
        _ => {
            p.directory.is_none()
                && p.namespace.is_none()
                && p.resource.is_none()
                && p.all.is_none()
                && p.prefix.is_none()
        }
    };
    if !allowed {
        return Err("补全参数与生成器不匹配".into());
    }
    Ok(Some(match id {
        "paths" => return Ok(None),
        "git-branches" => "git branch --list".into(),
        "git-remotes" => "git remote".into(),
        "docker-containers" => format!("docker ps {}--format '{{{{.ID}}}}\\t{{{{.Names}}}}'", if p.all.unwrap_or(false) { "-a " } else { "" }),
        "kubectl-resources" => {
            let resource = p.resource.as_deref().unwrap_or("pods");
            let namespace = p.namespace.as_deref().unwrap_or("default");
            if !RESOURCES.contains(&resource) || namespace.is_empty() || namespace.len() > 253 || !namespace.bytes().all(|c| c.is_ascii_alphanumeric() || b"-.".contains(&c)) {
                return Err("资源类型或 namespace 非法".into());
            }
            format!("kubectl get {resource} -o name -n {}", quote(namespace))
        },
        "kubectl-contexts" => "kubectl config get-contexts -o name".into(),
        "systemd-service-units" => "systemctl list-unit-files --type=service --no-pager --no-legend 2>/dev/null | awk '{print $1}'".into(),
        "systemd-active-units" => "systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | awk '{print $1}'".into(),
        "systemd-failed-units" => "systemctl list-units --state=failed --type=service --no-pager --no-legend 2>/dev/null | awk '{print $1}'".into(),
        "npm-scripts" => "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const key of Object.keys((p&&p.scripts)||{})){console.log(key)}\"".into(),
        _ => return Err("未知补全生成器".into()),
    }))
}
pub(super) async fn run(
    handle: &client::Handle<ClientHandler>,
    id: String,
    params: CompletionParams,
    cwd: Option<String>,
) -> Result<CompletionResult, SshError> {
    validate(&id, &params, cwd.as_deref()).map_err(|e| e.to_string())?;
    let script = template(&id, &params)?;
    timeout(Duration::from_secs(3), async {
        if let Some(script) = script {
            let command = match cwd.filter(|v| !v.is_empty()) {
                Some(cwd) => format!("cd {} && {script}", quote(&cwd)),
                None => script,
            };
            let mut channel = handle
                .channel_open_session()
                .await
                .map_err(|e| e.to_string())?;
            channel
                .exec(true, command)
                .await
                .map_err(|e| e.to_string())?;
            let mut output = Vec::new();
            let mut exit_code = 0;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => {
                        if output.len() + data.len() > 1024 * 1024 {
                            let _ = channel.close().await;
                            return Err("补全输出超过上限".into());
                        }
                        output.extend_from_slice(&data);
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
                    _ => {}
                }
            }
            Ok(CompletionResult {
                output: String::from_utf8_lossy(&output).into_owned(),
                candidates: vec![],
                exit_code,
            })
        } else {
            let channel = handle
                .channel_open_session()
                .await
                .map_err(|e| e.to_string())?;
            channel
                .request_subsystem(true, "sftp")
                .await
                .map_err(|e| e.to_string())?;
            let raw = RawSftpSession::new(channel.into_stream());
            raw.set_timeout(3);
            let result = paths(&raw, params, cwd).await;
            let _ = raw.close_session();
            result
        }
    })
    .await
    .map_err(|_| "补全请求超时".to_string())?
    .map_err(Into::into)
}
async fn paths(
    raw: &RawSftpSession,
    params: CompletionParams,
    cwd: Option<String>,
) -> Result<CompletionResult, String> {
    raw.init().await.map_err(|e| e.to_string())?;
    let directory = params.directory.as_deref().unwrap_or(".");
    let home = if directory == "~" || directory.starts_with("~/") || cwd.is_none() {
        raw.realpath(".")
            .await
            .map_err(|e| e.to_string())?
            .files
            .first()
            .map(|f| f.filename.clone())
            .unwrap_or_else(|| ".".into())
    } else {
        String::new()
    };
    let path = if directory == "~" {
        home
    } else if let Some(rest) = directory.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else if directory.starts_with('/') {
        directory.into()
    } else {
        format!("{}/{directory}", cwd.unwrap_or(home))
    };
    let directory_handle = raw.opendir(path).await.map_err(|e| e.to_string())?.handle;
    let result = async {
        let mut candidates = Vec::new();
        let mut scanned = 0;
        loop {
            let batch = match raw.readdir(&directory_handle).await {
                Ok(batch) => batch,
                Err(SftpError::Status(s)) if s.status_code == StatusCode::Eof => break,
                Err(e) => return Err(e.to_string()),
            };
            for file in batch.files {
                scanned += 1;
                if file.filename == "."
                    || file.filename == ".."
                    || file.filename.chars().any(char::is_control)
                {
                    continue;
                }
                if params
                    .prefix
                    .as_deref()
                    .is_some_and(|prefix| !file.filename.starts_with(prefix))
                {
                    continue;
                }
                candidates.push(PathCandidate {
                    name: file.filename,
                    is_dir: file.attrs.is_dir(),
                });
                if candidates.len() >= 200 {
                    break;
                }
            }
            if candidates.len() >= 200 || scanned >= 10000 {
                break;
            }
        }
        candidates.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(CompletionResult {
            candidates,
            ..CompletionResult::default()
        })
    }
    .await;
    let close = raw.close(directory_handle).await.map_err(|e| e.to_string());
    close?;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contract_rejects_scripts_unexpected_parameters_and_injection() {
        assert!(validate(
            "git branch; touch /tmp/x",
            &CompletionParams::default(),
            None
        )
        .is_err());
        assert!(validate(
            "git-branches",
            &CompletionParams {
                namespace: Some("x".into()),
                ..Default::default()
            },
            None
        )
        .is_err());
        assert!(validate(
            "kubectl-resources",
            &CompletionParams {
                namespace: Some("x;id".into()),
                ..Default::default()
            },
            None
        )
        .is_err());
        assert!(validate(
            "paths",
            &CompletionParams {
                directory: Some("空格 ' 中文/".into()),
                ..Default::default()
            },
            Some("/工作目录")
        )
        .is_ok());
        assert!(validate("paths", &CompletionParams::default(), Some("/tmp\nrm")).is_err());
    }
    #[test]
    fn fixed_templates_have_consistent_options() {
        let p = CompletionParams {
            resource: Some("services".into()),
            namespace: Some("kube-system".into()),
            ..Default::default()
        };
        assert_eq!(
            template("kubectl-resources", &p).unwrap().unwrap(),
            "kubectl get services -o name -n 'kube-system'"
        );
        assert!(template(
            "docker-containers",
            &CompletionParams {
                all: Some(true),
                ..Default::default()
            }
        )
        .unwrap()
        .unwrap()
        .starts_with("docker ps -a "));
        assert!(template("paths", &CompletionParams::default())
            .unwrap()
            .is_none());
        assert!(
            serde_json::from_value::<CompletionParams>(serde_json::json!({"script":"id"})).is_err()
        );
    }
    struct DirectoryServer {
        closed: std::sync::Arc<std::sync::atomic::AtomicBool>,
        sent: bool,
    }
    impl russh_sftp::server::Handler for DirectoryServer {
        type Error = StatusCode;
        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }
        async fn opendir(
            &mut self,
            id: u32,
            path: String,
        ) -> Result<russh_sftp::protocol::Handle, Self::Error> {
            assert_eq!(path, "/工作目录/空格 ' 路径/");
            Ok(russh_sftp::protocol::Handle {
                id,
                handle: "directory".into(),
            })
        }
        async fn readdir(
            &mut self,
            id: u32,
            handle: String,
        ) -> Result<russh_sftp::protocol::Name, Self::Error> {
            assert_eq!(handle, "directory");
            if self.sent {
                return Err(StatusCode::Eof);
            }
            self.sent = true;
            Ok(russh_sftp::protocol::Name {
                id,
                files: ["中文 name@*", "quote'file", "line\nbreak", ".", ".."]
                    .into_iter()
                    .map(russh_sftp::protocol::File::dummy)
                    .collect(),
            })
        }
        async fn close(
            &mut self,
            id: u32,
            handle: String,
        ) -> Result<russh_sftp::protocol::Status, Self::Error> {
            assert_eq!(handle, "directory");
            self.closed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(russh_sftp::protocol::Status {
                id,
                status_code: StatusCode::Ok,
                error_message: String::new(),
                language_tag: String::new(),
            })
        }
    }
    #[tokio::test]
    async fn structured_names_survive_special_characters_and_directory_handles_close() {
        let (client, server) = tokio::io::duplex(4096);
        let closed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = tokio::spawn(russh_sftp::server::run(
            server,
            DirectoryServer {
                closed: closed.clone(),
                sent: false,
            },
        ));
        let raw = RawSftpSession::new(client);
        let result = paths(
            &raw,
            CompletionParams {
                directory: Some("空格 ' 路径/".into()),
                ..Default::default()
            },
            Some("/工作目录".into()),
        )
        .await
        .unwrap();
        assert_eq!(
            result
                .candidates
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["quote'file", "中文 name@*"]
        );
        assert!(closed.load(std::sync::atomic::Ordering::SeqCst));
        raw.close_session().unwrap();
        task.await.unwrap();
    }
}
