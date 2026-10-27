/** Public synthetic fixture key, used only with fresh temporary smoke databases. Never a device key. */
export function accountFixtureKey(): Buffer {
  return Buffer.alloc(32, 71)
}
