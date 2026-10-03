import type { CompletionData } from '@/types/completion'
interface CacheEntry { data: CompletionData; timestamp: number; bytes: number }
export interface CompletionCache {
  get(generatorKey: string, cwd: string | undefined, ttl: number): CompletionData | null
  set(generatorKey: string, cwd: string | undefined, data: CompletionData): void
  clear(): void
}
/** One cache per terminal, including workspace/profile/connection identity in every key. */
export function createCompletionCache(scope: () => string = () => ''): CompletionCache {
  const cache = new Map<string, CacheEntry>()
  let bytes = 0
  const keyOf = (generator: string, cwd?: string) => JSON.stringify([scope(), cwd ?? '', generator])
  const remove = (key: string) => { bytes -= cache.get(key)?.bytes ?? 0; cache.delete(key) }
  return {
    get(generator, cwd, ttl) {
      const key = keyOf(generator, cwd), entry = cache.get(key)
      if (!entry) return null
      if (Date.now() - entry.timestamp >= ttl) { remove(key); return null }
      cache.delete(key); cache.set(key, entry)
      return entry.data
    },
    set(generator, cwd, input) {
      const key = keyOf(generator, cwd)
      const data: CompletionData = { output: input.output.split('\n').slice(0, 200).join('\n'), ...(input.candidates ? { candidates: input.candidates.slice(0, 200) } : {}) }
      const size = new TextEncoder().encode(key + JSON.stringify(data)).byteLength
      remove(key)
      if (size > 1024 * 1024) return
      cache.set(key, { data, bytes: size, timestamp: Date.now() }); bytes += size
      while (cache.size > 128 || bytes > 1024 * 1024) remove(cache.keys().next().value!)
    },
    clear() { cache.clear(); bytes = 0 },
  }
}
