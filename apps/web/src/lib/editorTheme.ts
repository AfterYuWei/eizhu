import type * as Monaco from 'monaco-editor'

/** Monaco only accepts hex colors; resolve the same CSS tokens used by the shell. */
export function applyEditorTheme(monaco: typeof Monaco, mode: 'light' | 'dark'): string {
  const styles = getComputedStyle(document.documentElement)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const color = (token: string, opacity = 1) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = styles.getPropertyValue(token).trim()
    context.fillRect(0, 0, 1, 1)
    const rgba = context.getImageData(0, 0, 1, 1).data
    rgba[3] = Math.round(rgba[3] * opacity)
    return '#' + Array.from(rgba, (channel) => channel.toString(16).padStart(2, '0')).join('')
  }
  const background = color('--surface-workspace')
  const foreground = color('--fg')
  const muted = color('--fg', 0.5)
  const border = color('--border-subtle')
  const widget = color('--surface-overlay')
  const selection = color('--fg', 0.14)
  const name = `eizhu-${mode}`
  monaco.editor.defineTheme(name, {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'focusBorder': color('--fg', 0.35),
      'foreground': foreground,
      'descriptionForeground': muted,
      'editor.background': background,
      'editor.foreground': foreground,
      'editorGutter.background': background,
      'editorLineNumber.foreground': color('--fg', 0.38),
      'editorLineNumber.activeForeground': color('--fg', 0.75),
      'editor.lineHighlightBackground': color('--fg', 0.035),
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': foreground,
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': color('--fg', 0.08),
      'editor.selectionHighlightBackground': color('--fg', 0.06),
      'editor.wordHighlightBackground': color('--fg', 0.06),
      'editor.wordHighlightStrongBackground': color('--fg', 0.1),
      'editorIndentGuide.background1': border,
      'editorIndentGuide.activeBackground1': color('--fg', 0.3),
      'editorWidget.background': widget,
      'editorWidget.foreground': foreground,
      'editorWidget.border': border,
      'editorSuggestWidget.background': widget,
      'editorSuggestWidget.foreground': foreground,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': color('--bg-active'),
      'editorSuggestWidget.selectedForeground': foreground,
      'editorHoverWidget.background': widget,
      'editorHoverWidget.foreground': foreground,
      'editorHoverWidget.border': border,
      'editorHoverWidget.statusBarBackground': color('--surface-app'),
      'input.background': color('--bg-input'),
      'input.foreground': foreground,
      'input.border': color('--border'),
      'input.placeholderForeground': muted,
      'inputOption.activeBackground': selection,
      'inputOption.activeBorder': color('--fg', 0.35),
      'list.activeSelectionBackground': selection,
      'list.activeSelectionForeground': foreground,
      'list.hoverBackground': color('--bg-hover'),
      'editorError.foreground': color('--red'),
      'editorWarning.foreground': color('--yellow'),
      'scrollbarSlider.background': color('--fg', 0.13),
      'scrollbarSlider.hoverBackground': color('--fg', 0.22),
      'scrollbarSlider.activeBackground': color('--fg', 0.3),
    },
  })
  monaco.editor.setTheme(name)
  return name
}
