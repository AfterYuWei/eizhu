/** Defense in depth. Callers must still never log resolved credentials or unstructured protocol payloads. */
export function redactLogText(text: string): string {
  return text
    .replace(
      /-----BEGIN[^\r\n]{0,80}PRIVATE KEY-----[\s\S]*?-----END[^\r\n]{0,80}PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|password|passphrase)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:password|passphrase|private_key|authorization|access_token|refresh_token|credential)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@')
}
