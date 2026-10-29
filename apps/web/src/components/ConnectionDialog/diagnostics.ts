const STAGES: Record<string, string> = {
  submitting: '创建连接会话',
  preparing: '读取连接配置',
  credential: '读取认证信息',
  connecting: '连接服务器',
  resolve: '检查连接路由',
  proxy: '连接代理或跳板',
  establishing_ssh: '建立 SSH 通道',
  host_key: '核对服务器身份',
  hostkey_check: '核对服务器身份',
  hostkey_confirm: '等待确认主机指纹',
  ssh_auth: '验证登录凭据',
  starting_shell: '打开远程终端',
  ready: '终端已就绪',
  disconnected: '连接中断',
  retry_wait: '等待重新连接',
  shell_closed: '远端终端已关闭',
  clipboard: '复制操作',
}

export function stageLabel(stage?: string): string {
  return stage ? (STAGES[stage] ?? '连接过程') : '连接过程'
}

/** 建议以明确的错误码为依据；信息不足时不猜测网络或认证原因。 */
export function connectionDiagnosis(code?: string): { title: string; suggestion: string } {
  switch (code) {
    case 'SSH_DNS_FAILED':
    case 'PROXY_DNS_FAILED':
      return {
        title: '域名解析失败',
        suggestion: '检查服务器或代理的域名是否填写正确，以及当前网络的 DNS 是否可用。',
      }
    case 'SSH_CONNECTION_REFUSED':
      return {
        title: 'SSH 端口拒绝连接',
        suggestion: '确认连接端口正确，并检查服务器上的 SSH 服务是否已启动、是否监听该端口。',
      }
    case 'PROXY_CONNECTION_REFUSED':
      return { title: '代理端口拒绝连接', suggestion: '检查代理地址与端口，并确认代理服务已启动。' }
    case 'SSH_NETWORK_UNREACHABLE':
    case 'PROXY_NETWORK_UNREACHABLE':
      return {
        title: '目标网络不可达',
        suggestion: '检查本机网络、VPN 或连接路由；如目标位于内网，请确认已接入对应网络。',
      }
    case 'SSH_TIMEOUT':
    case 'PROXY_TIMEOUT':
      return {
        title: '连接超时',
        suggestion: '检查目标地址、端口和防火墙规则；如配置了代理或跳板，也请确认它们能够访问目标。',
      }
    case 'SSH_AUTH_FAILED':
      return {
        title: '登录认证未通过',
        suggestion: '检查用户名及所选密码、私钥或密钥库条目，并确认服务器允许该账号使用当前认证方式。',
      }
    case 'SSH_KEY_INVALID':
    case 'INVALID_PRIVATE_KEY':
      return {
        title: '无法读取认证密钥',
        suggestion: '检查私钥格式及私钥密码；使用密钥库时，请重新选择有效的密钥条目。',
      }
    case 'CREDENTIAL_MISSING':
      return {
        title: '缺少登录凭据',
        suggestion: '编辑连接，补全所选认证方式需要的密码或私钥；使用密钥库时确认对应条目仍存在。',
      }
    case 'AGENT_UNAVAILABLE':
      return {
        title: 'SSH Agent 不可用',
        suggestion: '启动系统 SSH Agent 并加载密钥，或在连接设置中改用密码、私钥认证。',
      }
    case 'SSH_NEGOTIATION_FAILED':
      return {
        title: 'SSH 加密算法不兼容',
        suggestion: '核对服务器支持的 SSH 算法，优先更新服务器的 SSH 服务与主机密钥配置。',
      }
    case 'HOST_KEY_REJECTED':
    case 'HOST_KEY_CHECK_FAILED':
    case 'HOST_KEY_CONFIRM_REQUIRED':
    case 'STALE_CONFIRMATION':
      return {
        title: '主机身份未通过确认',
        suggestion: '通过可信渠道核对服务器主机指纹，再重新连接并确认当前提示。',
      }
    case 'PROXY_AUTH_FAILED':
      return {
        title: '代理认证未通过',
        suggestion: '检查代理类型、用户名及密码，并确认代理服务支持所选认证方式。',
      }
    case 'PROXY_REJECTED':
    case 'PROXY_PROTOCOL':
      return {
        title: '代理未能建立通道',
        suggestion: '检查 HTTP / SOCKS5 代理类型及访问规则，确认代理允许访问目标地址与端口。',
      }
    case 'JUMP_FAILED':
    case 'INVALID_PROXY_CHAIN':
      return {
        title: '跳板连接未完成',
        suggestion: '检查跳板连接配置，并确认跳板允许 TCP 转发且能够访问目标地址与端口。',
      }
    case 'SSH_SHELL_FAILED':
      return {
        title: '无法打开远程终端',
        suggestion: '服务器已经通过登录认证。请检查账号的登录 Shell、PTY 权限及终端访问限制。',
      }
    case 'SSH_CONNECTION_RESET':
    case 'PROXY_CONNECTION_RESET':
      return { title: '连接被关闭', suggestion: '检查服务器或代理的访问限制与服务日志，再尝试重新连接。' }
    default:
      return {
        title: '连接未完成',
        suggestion: '展开连接记录查看最后执行的操作；若重试后仍失败，可复制诊断信息用于排查。',
      }
  }
}
