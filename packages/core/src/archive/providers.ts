import { createHash, createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { cloudIndexSchema, fail } from '@eizhu/contracts'
import type { CloudIndex } from '@eizhu/contracts'
import type { Provider } from './repository.ts'
import { jsonBody, successful } from './network.ts'
import type { HttpResponse, Transport } from './network.ts'
const awsEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')
const hmac = (key: string | Uint8Array, s: string) => createHmac('sha256', key).update(s).digest()
export function signS3(
  url: URL,
  method: string,
  body: Uint8Array,
  access: string,
  secret: string,
  region: string,
  now = new Date(),
  extra: Record<string, string> = {},
): Record<string, string> {
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    day = date.slice(0, 8)
  const headers: Record<string, string> = {
    ...extra,
    host: url.host,
    'x-amz-date': date,
    'x-amz-content-sha256': sha(body),
  }
  const keys = Object.keys(headers).sort(),
    canonicalHeaders = keys.map((k) => `${k}:${headers[k].trim()}\n`).join('')
  const query = [...url.searchParams]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map((p) => p.join('='))
    .join('&')
  const canonical = [method, url.pathname, query, canonicalHeaders, keys.join(';'), sha(body)].join('\n'),
    scope = `${day}/${region}/s3/aws4_request`
  const key = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), 's3'), 'aws4_request')
  try {
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${keys.join(';')}, Signature=${hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).toString('hex')}`
  } finally {
    key.fill(0)
  }
  return headers
}
const driveList = z.object({
  files: z.array(z.object({ id: z.string().regex(/^[\w-]+$/), name: z.string().optional() })).max(100),
  nextPageToken: z.string().optional(),
})
export class CloudProvider {
  readonly row: Provider
  private network: Transport
  private signal: AbortSignal
  private namespace: string
  private accessToken: () => Promise<string>
  private folder?: string
  constructor(
    row: Provider,
    namespace: string,
    network: Transport,
    signal: AbortSignal,
    accessToken: () => Promise<string>,
  ) {
    this.row = row
    this.namespace = namespace
    this.network = network
    this.signal = signal
    this.accessToken = accessToken
  }
  private async request(
    method: string,
    url: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const response = await this.network({ url, method, body, headers }, this.signal)
    if (response.body.byteLength > 52 * 1024 * 1024) fail('FILE_TOO_LARGE', '云端响应超过大小限制')
    return response
  }
  private async oauthRequest(
    method: string,
    url: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    return this.request(method, url, body, {
      ...headers,
      authorization: `Bearer ${await this.accessToken()}`,
    })
  }
  private async driveFiles(query: string) {
    const url = new URL('https://www.googleapis.com/drive/v3/files')
    url.search = new URLSearchParams({
      q: query,
      fields: 'files(id,name),nextPageToken',
      pageSize: '100',
    }).toString()
    const parsed = driveList.parse(jsonBody(successful(await this.oauthRequest('GET', url.href))))
    if (parsed.nextPageToken) fail('CLOUD_DATA_INVALID', '云端存在过多同名文件，需先整理目标目录')
    return parsed.files
  }
  private async driveFolder(): Promise<string> {
    if (this.folder) return this.folder
    const name = `eizhu-backups-${this.namespace}`
    const folders = await this.driveFiles(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    )
    if (folders.length > 1) fail('BACKUP_CONFLICT', 'Drive 存在重复备份目录，请先整理')
    if (folders[0]) return (this.folder = folders[0].id)
    const result = await this.oauthRequest(
      'POST',
      'https://www.googleapis.com/drive/v3/files',
      Buffer.from(JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })),
      { 'content-type': 'application/json' },
    )
    this.folder = z.object({ id: z.string().regex(/^[\w-]+$/) }).parse(jsonBody(successful(result))).id
    return this.folder
  }
  private async driveId(name: string): Promise<string | undefined> {
    const files = await this.driveFiles(
      `'${await this.driveFolder()}' in parents and name='${name}' and trashed=false`,
    )
    if (files.length > 1) fail('BACKUP_CONFLICT', 'Drive 存在重复备份对象，请先整理')
    return files[0]?.id
  }
  private graphFolder(): string {
    return `${this.row.config.onedrive_folder || 'eizhu-backups'}-${this.namespace}`
  }
  private graphPath(name: string): string {
    return (
      'https://graph.microsoft.com/v1.0/me/drive/root:/' + [this.graphFolder(), name].map(awsEncode).join('/')
    )
  }
  private async direct(
    method: string,
    name: string,
    body = Buffer.alloc(0),
    extra: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const c = this.row.config
    if (c.type === 'webdav') {
      const root = c.endpoint!.replace(/\/+$/, '') + `/eizhu-${this.namespace}/`
      const headers = {
        ...extra,
        authorization: 'Basic ' + Buffer.from(`${c.username || ''}:${c.password || ''}`).toString('base64'),
      }
      if (method === 'PUT') {
        const mk = await this.request('MKCOL', root, undefined, headers)
        if (mk.status !== 405) successful(mk)
      }
      return this.request(method, root + awsEncode(name), body.length ? body : undefined, headers)
    }
    const region = c.s3_region || 'us-east-1',
      prefix = (c.s3_prefix || '').replace(/^\/+|\/+$/g, '')
    const key = [prefix, 'spaces', this.namespace, name]
      .filter(Boolean)
      .map((v) => v.split('/').map(awsEncode).join('/'))
      .join('/')
    const pathStyle = c.s3_path_style || !!c.s3_endpoint
    const base = c.s3_endpoint || `https://${pathStyle ? '' : c.s3_bucket + '.'}s3.${region}.amazonaws.com`
    const url = new URL(
      base.replace(/\/+$/, '') + '/' + (pathStyle ? awsEncode(c.s3_bucket!) + '/' : '') + key,
    )
    return this.request(
      method,
      url.href,
      body.length ? body : undefined,
      signS3(url, method, body, c.s3_access_key!, c.s3_secret_key!, region, new Date(), extra),
    )
  }
  async get(name: string): Promise<HttpResponse> {
    if (this.row.config.type === 'webdav' || this.row.config.type === 's3') return this.direct('GET', name)
    if (this.row.config.type === 'gdrive') {
      const id = await this.driveId(name)
      if (!id) return { status: 404, headers: {}, body: new Uint8Array() }
      return this.oauthRequest('GET', `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
    }
    const meta = await this.oauthRequest('GET', this.graphPath(name))
    if (meta.status === 404) return meta
    const info = z
      .object({ eTag: z.string(), '@microsoft.graph.downloadUrl': z.url() })
      .parse(jsonBody(successful(meta)))
    const url = new URL(info['@microsoft.graph.downloadUrl'])
    if (url.protocol !== 'https:' || url.username || url.password)
      fail('CLOUD_DATA_INVALID', 'OneDrive 下载地址无效')
    // A short-lived download URL is read without the OAuth bearer token. Never follow another redirect.
    const data = await this.request('GET', url.href)
    return { ...data, headers: { ...data.headers, etag: info.eTag } }
  }
  async put(name: string, bytes: Uint8Array, expected?: string | null): Promise<void> {
    const condition: Record<string, string> =
      expected === null ? { 'if-none-match': '*' } : expected ? { 'if-match': expected } : {}
    if (this.row.config.type === 'webdav' || this.row.config.type === 's3') {
      successful(await this.direct('PUT', name, Buffer.from(bytes), condition))
      return
    }
    if (this.row.config.type === 'gdrive') {
      const id = await this.driveId(name)
      if (expected === null && id) fail('BACKUP_CONFLICT', '云端对象已出现，请重新提交')
      if (expected && !id) fail('BACKUP_CONFLICT', '云端对象已删除，请刷新')
      if (id) {
        successful(
          await this.oauthRequest(
            'PATCH',
            `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
            bytes,
            { 'content-type': 'application/octet-stream', ...condition },
          ),
        )
        return
      }
      const boundary = 'eizhu-' + randomUUID(),
        metadata = JSON.stringify({ name, parents: [await this.driveFolder()] })
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      try {
        successful(
          await this.oauthRequest(
            'POST',
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            body,
            { 'content-type': `multipart/related; boundary=${boundary}` },
          ),
        )
      } finally {
        body.fill(0)
      }
      return
    }
    const folder = this.graphFolder()
    const mk = await this.oauthRequest(
      'POST',
      'https://graph.microsoft.com/v1.0/me/drive/root/children',
      Buffer.from(JSON.stringify({ name: folder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })),
      { 'content-type': 'application/json' },
    )
    if (mk.status !== 409) successful(mk)
    successful(
      await this.oauthRequest('PUT', this.graphPath(name) + ':/content', bytes, {
        'content-type': 'application/octet-stream',
        ...condition,
      }),
    )
  }
  async remove(name: string): Promise<void> {
    let result: HttpResponse
    if (this.row.config.type === 'webdav' || this.row.config.type === 's3')
      result = await this.direct('DELETE', name)
    else if (this.row.config.type === 'gdrive') {
      const id = await this.driveId(name)
      if (!id) return
      result = await this.oauthRequest('DELETE', `https://www.googleapis.com/drive/v3/files/${id}`)
    } else result = await this.oauthRequest('DELETE', this.graphPath(name))
    if (result.status !== 404) successful(result)
  }
  async index(): Promise<{ index: CloudIndex; etag: string | null; exists: boolean }> {
    const response = await this.get('index.json')
    if (response.status === 404)
      return {
        index: {
          format: 'eizhu-sync-index',
          version: 1,
          device_id: this.namespace,
          latest_version: 0,
          versions: [],
          updated_at: new Date(0).toISOString(),
        },
        etag: null,
        exists: false,
      }
    successful(response)
    if (response.body.byteLength > 4 * 1024 * 1024) fail('CLOUD_DATA_INVALID', '云端索引过大')
    const parsed = cloudIndexSchema.safeParse(jsonBody(response))
    if (!parsed.success) fail('CLOUD_DATA_INVALID', '云端索引无效，原对象已保留')
    if (parsed.data.device_id !== this.namespace)
      fail('BACKUP_CONFLICT', '云端索引属于其他设备空间，已停止写入')
    return { index: parsed.data, exists: true, etag: response.headers.etag || null }
  }
  async test(): Promise<void> {
    const name = `probe-${randomUUID()}.tmp`,
      bytes = Buffer.from(randomUUID())
    try {
      await this.put(name, bytes, null)
      const read = successful(await this.get(name))
      if (sha(read.body) !== sha(bytes)) fail('CLOUD_DATA_INVALID', '目标读回校验失败')
    } finally {
      await this.remove(name)
    }
  }
}
