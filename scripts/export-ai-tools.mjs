import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { AI_TOOLSET_VERSION, aiToolManifest } from '@eizhu/contracts'
const content = JSON.stringify({ version: AI_TOOLSET_VERSION, tools: aiToolManifest }, null, 2) + '\n'
const check = process.argv.find((v) => v.startsWith('--check='))?.slice(8)
const out = process.argv.find((v) => v.startsWith('--out='))?.slice(6)
if (check)
  assert.deepEqual(JSON.parse(await readFile(check, 'utf8')), JSON.parse(content), '工具目录与后台清单不一致')
else if (out) await writeFile(out, content)
else process.stdout.write(content)
