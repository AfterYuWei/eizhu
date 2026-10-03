export type CompletionGeneratorId = 'paths' | 'git-branches' | 'git-remotes' | 'docker-containers'
  | 'kubectl-resources' | 'kubectl-contexts' | 'systemd-service-units' | 'systemd-active-units'
  | 'systemd-failed-units' | 'npm-scripts'
export interface CompletionParams { directory?: string; prefix?: string; namespace?: string; resource?: string; all?: boolean }
export interface CompletionGeneratorRequest { generatorId: CompletionGeneratorId; params: CompletionParams }
export interface CompletionData { output: string; candidates?: { name: string; is_dir: boolean }[] }
