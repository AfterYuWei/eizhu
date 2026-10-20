/** Page actions own sessions independently of React's mount/unmount lifecycle. */
const owners = new Map<string, () => Promise<void>>()
export function registerFileOwner(id: string, close: () => Promise<void>) {
  owners.set(id, close)
  return () => {
    if (owners.get(id) === close) owners.delete(id)
  }
}
export async function closeFileOwner(id: string) {
  const close = owners.get(id)
  if (close) {
    await close()
    owners.delete(id)
  }
}
