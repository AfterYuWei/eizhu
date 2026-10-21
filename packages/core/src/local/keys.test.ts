import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const encrypted of [false, true]) {
  test(`Ed25519 preserves two leading zero public-key octets (${encrypted ? 'encrypted' : 'plain'})`, () => {
    // Public synthetic seed 36 deterministically produces a key starting 00 00 1f.
    // Hook crypto before ssh2 loads so its real encoder receives this valid DER key.
    const script = `
      const assert = require('node:assert/strict');
      const crypto = require('node:crypto');
      const seed = Buffer.alloc(32); seed[31] = 36;
      const privateKey = crypto.createPrivateKey({key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'), seed
      ]), format: 'der', type: 'pkcs8'});
      const publicKey = crypto.createPublicKey(privateKey);
      const expected = Buffer.from(publicKey.export({format:'jwk'}).x, 'base64url');
      assert.deepEqual([...expected.subarray(0, 3)], [0, 0, 31]);
      crypto.generateKeyPairSync = () => ({
        publicKey: publicKey.export({format:'der',type:'spki'}),
        privateKey: privateKey.export({format:'der',type:'pkcs8'})
      });
      (async () => {
        const {utils} = require('ssh2');
        const passphrase = ${encrypted ? "'合成 key 密语'" : 'undefined'};
        const pair = utils.generateKeyPairSync('ed25519', passphrase ? {passphrase,cipher:'aes256-ctr',rounds:16} : {});
        const publicParsed = utils.parseKey(pair.public);
        const privateParsed = utils.parseKey(pair.private, passphrase);
        assert.ok(!(publicParsed instanceof Error), publicParsed.message);
        assert.ok(!(privateParsed instanceof Error), privateParsed.message);
        assert.ok(privateParsed.isPrivateKey());
        assert.deepEqual(publicParsed.getPublicSSH().subarray(-32), expected);
        assert.deepEqual(privateParsed.getPublicSSH(), publicParsed.getPublicSSH());
        const data = Buffer.from('leading-zero regression');
        assert.equal(publicParsed.verify(data, privateParsed.sign(data)), true);
        if (passphrase) assert.ok(utils.parseKey(pair.private, 'wrong') instanceof Error);
        console.log('leading-zero key roundtrip passed');
      })().catch((error) => {console.error('leading-zero key roundtrip failed:', error.message);process.exitCode=1;});
    `
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=commonjs', '-e', script],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        encoding: 'utf8',
      },
    )
    assert.match(output, /leading-zero key roundtrip passed/)
  })
}
