/** Electron's V8 headers require Clang-compatible attribute handling on our Linux baseline. */
export function nativeToolchainEnvironment(environment = process.env, platform = process.platform) {
  return platform === 'linux'
    ? { ...environment, CC: environment.CC || 'clang', CXX: environment.CXX || 'clang++' }
    : { ...environment }
}
