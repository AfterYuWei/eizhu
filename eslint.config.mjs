import js from '@eslint/js'
import ts from 'typescript-eslint'
import globals from 'globals'
export default [
  { ignores: ['**/out/**', '**/dist/**', '**/node_modules/**', 'src-tauri/**', 'apps/web/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
]
