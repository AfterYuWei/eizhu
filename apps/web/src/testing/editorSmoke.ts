import { loader, monaco } from '@/lib/monaco'
import { languageWorkerReady } from './languageWorkerReady'
const result = document.getElementById('result')!
async function check(): Promise<void> {
  await loader.init()
  const model = monaco.editor.createModel(
    'const numberValue: number = "synthetic"',
    'typescript',
    monaco.Uri.parse('inmemory://eizhu/smoke.ts'),
  )
  const editor = monaco.editor.create(document.getElementById('editor')!, { model })
  const getWorker = await languageWorkerReady(
    () => monaco.typescript.getTypeScriptWorker(),
    'TypeScript not registered!',
  )
  const worker = await getWorker(model.uri)
  const diagnostics = await worker.getSemanticDiagnostics(model.uri.toString())
  if (!diagnostics.some((diagnostic) => diagnostic.code === 2322))
    throw new Error('TypeScript worker did not validate the local model')
  const json = monaco.editor.createModel(
    '{ "synthetic": }',
    'json',
    monaco.Uri.parse('inmemory://eizhu/smoke.json'),
  )
  const getJsonWorker = await languageWorkerReady(() => monaco.json.getWorker(), 'JSON not registered!')
  await getJsonWorker(json.uri)
  for (
    let attempt = 0;
    attempt < 100 && !monaco.editor.getModelMarkers({ resource: json.uri }).length;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!monaco.editor.getModelMarkers({ resource: json.uri }).length)
    throw new Error('JSON worker did not publish local validation markers')
  result.textContent = JSON.stringify({
    typescript: true,
    json: true,
    model: editor.getValue().includes('synthetic'),
  })
  result.dataset.state = 'passed'
  editor.dispose()
  model.dispose()
  json.dispose()
}
void check().catch((error) => {
  result.dataset.state = 'failed'
  result.textContent = error instanceof Error ? error.message : String(error)
})
