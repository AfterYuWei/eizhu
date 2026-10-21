import test from 'node:test'
import assert from 'node:assert/strict'
import { CloudProvider, signS3 } from './providers.ts'
import type { Provider } from './repository.ts'
import type { HttpRequest, Transport } from './network.ts'
import { successful } from './network.ts'
import { archive, cloudIndexSchema, providerConfigSchema } from '@eizhu/contracts'
const row: Provider = {
  meta: {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'webdav',
    name: '合成目标',
    enabled: true,
    created_at: '',
    updated_at: '',
  },
  revision: 1,
  config: {
    type: 'webdav',
    name: '合成目标',
    enabled: true,
    endpoint: 'https://dav.example.invalid/root',
    username: 'synthetic',
    password: 'secret',
  },
}
test('cloud contracts reject path traversal, embedded credentials, unsafe counts, corrupt indices and official targets', () => {
  assert.equal(
    providerConfigSchema.safeParse({ ...row.config, endpoint: 'https://user:pass@example.invalid' }).success,
    false,
  )
  assert.equal(providerConfigSchema.safeParse({ ...row.config, type: 'account' }).success, false)
  assert.equal(
    archive['backup.previewCloud'].input.safeParse({ providerId: row.meta.id, object: '../index.json' })
      .success,
    false,
  )
  assert.equal(
    archive['backup.updateSettings'].input.safeParse({ settings: {}, backupPassword: 'short' }).success,
    false,
  )
  assert.equal(
    cloudIndexSchema.safeParse({
      format: 'eizhu-sync-index',
      version: 1,
      device_id: 'x',
      latest_version: 2 ** 54,
      versions: [],
      updated_at: '',
    }).success,
    false,
  )
})
test('WebDAV creates only its namespaced collection, sends conditional writes and never follows redirects', async () => {
  const calls: HttpRequest[] = [],
    network: Transport = async (d) => {
      calls.push(d)
      return {
        status: d.method === 'MKCOL' ? 405 : 302,
        headers: { location: 'https://attacker.example.invalid' },
        body: new Uint8Array(),
      }
    }
  const provider = new CloudProvider(row, 'offline-test', network, new AbortController().signal, async () =>
    assert.fail('DAV cannot request OAuth'),
  )
  await assert.rejects(provider.put('index.json', Buffer.from('{}'), '"previous"'), /HTTP 302/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers['if-match'], '"previous"')
  assert.equal(calls[1].url, 'https://dav.example.invalid/root/eizhu-offline-test/index.json')
})
test('malformed index, foreign namespace, duplicate versions and HTTP failures cannot become an empty cloud', async () => {
  for (const value of [
    'not JSON',
    JSON.stringify({
      format: 'eizhu-sync-index',
      version: 1,
      device_id: 'other',
      latest_version: 0,
      versions: [],
      updated_at: '',
    }),
  ]) {
    const provider = new CloudProvider(
      row,
      'offline-test',
      async () => ({ status: 200, headers: {}, body: Buffer.from(value) }),
      new AbortController().signal,
      async () => '',
    )
    await assert.rejects(provider.index())
  }
  for (const status of [401, 403, 429, 500, 412])
    assert.throws(
      () => successful({ status, headers: {}, body: Buffer.from('sensitive error must not be returned') }),
      (e) => !String(e).includes('sensitive'),
    )
})
test('S3 SigV4 matches the AWS documented GET test vector', () => {
  const result = signS3(
    new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    'GET',
    Buffer.alloc(0),
    'AKIAIOSFODNN7EXAMPLE',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'us-east-1',
    new Date('2013-05-24T00:00:00Z'),
    { range: 'bytes=0-9' },
  )
  assert.equal(
    result['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    result.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  )
})

test('OneDrive download uses metadata ETag and never forwards bearer tokens to the download host', async () => {
  const one: Provider = {
    ...row,
    meta: { ...row.meta, type: 'onedrive' },
    config: { type: 'onedrive', name: 'OneDrive', enabled: true, oauth_client_id: 'client' },
  }
  const requests: HttpRequest[] = [],
    network: Transport = async (d) => {
      requests.push(d)
      if (d.url.startsWith('https://graph.microsoft.com/'))
        return {
          status: 200,
          headers: {},
          body: Buffer.from(
            JSON.stringify({
              eTag: '"graph-revision"',
              '@microsoft.graph.downloadUrl': 'https://download.example.invalid/signed',
            }),
          ),
        }
      assert.equal(d.headers.authorization, undefined)
      return { status: 200, headers: {}, body: Buffer.from('ciphertext') }
    }
  const provider = new CloudProvider(
    one,
    'offline-test',
    network,
    new AbortController().signal,
    async () => 'synthetic-bearer',
  )
  const result = await provider.get('v000001-0123456789ab.eizhubackup')
  assert.equal(result.headers.etag, '"graph-revision"')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].headers.authorization, 'Bearer synthetic-bearer')
})
test('Drive refuses ambiguous same-name folders instead of choosing an arbitrary destination', async () => {
  const drive: Provider = {
    ...row,
    meta: { ...row.meta, type: 'gdrive' },
    config: { type: 'gdrive', name: 'Drive', enabled: true, oauth_client_id: 'client' },
  }
  const provider = new CloudProvider(
    drive,
    'offline-test',
    async () => ({
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify({ files: [{ id: 'folder1' }, { id: 'folder2' }] })),
    }),
    new AbortController().signal,
    async () => 'synthetic',
  )
  await assert.rejects(provider.get('index.json'), /重复/)
})
