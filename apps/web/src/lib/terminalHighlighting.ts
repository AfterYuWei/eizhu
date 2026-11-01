import type { IBuffer, IDecoration, IDisposable, IMarker, ITerminalAddon, Terminal } from '@xterm/xterm'
import { getTerminalHighlightColors } from './terminalThemes'

interface HighlightOptions {
  theme: string
  commands: boolean
  logs: boolean
}
type Region = 'prompt' | 'command' | 'output'
interface Boundary {
  marker: IMarker
  cellMarker: IMarker
  column: number
  fixed: boolean
  offset: number
  region: Region
}
interface Position { row: number; column: number }
interface Cell extends Position {
  width: number
  region: Region
  eligible: boolean
  color?: string
}

/** Presentation only: OSC boundaries identify shell input; terminal bytes are never rewritten. */
export class TerminalHighlighting implements ITerminalAddon {
  private terminal?: Terminal
  private options: HighlightOptions
  private boundaries = new Set<Boundary>()
  private subscriptions: IDisposable[] = []
  private decorations = new Map<string, { decoration: IDecoration; marker: IMarker }>()
  private frame?: number

  constructor(options: HighlightOptions) { this.options = options }

  activate(terminal: Terminal) {
    this.terminal = terminal
    this.subscriptions = [
      terminal.parser.registerOscHandler(133, (data) => {
        const code = data.split(';')[0]
        const region = code === 'A' ? 'prompt' : code === 'B' ? 'command' : code === 'C' ? 'output' : undefined
        if (region && terminal.buffer.active.type === 'normal') this.capture(region)
        return false
      }),
      terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
        if (params[0] === 2 || params[0] === 3) this.reset()
        return false
      }),
      terminal.parser.registerEscHandler({ final: 'c' }, () => { this.reset(); return false }),
      terminal.onWriteParsed(() => { this.updateFixedOffsets(); this.schedule() }),
      terminal.onScroll(() => this.schedule()),
      terminal.onResize(() => this.resized()),
      terminal.buffer.onBufferChange(() => { this.clearDecorations(); this.schedule() }),
    ]
  }

  update(options: HighlightOptions) {
    this.options = options
    this.schedule()
  }

  reset() {
    for (const boundary of this.boundaries) boundary.marker.dispose()
    this.boundaries.clear()
    this.clearDecorations()
    this.schedule()
  }

  dispose() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    for (const subscription of this.subscriptions) subscription.dispose()
    for (const boundary of this.boundaries) boundary.marker.dispose()
    this.boundaries.clear()
    this.clearDecorations()
    this.terminal = undefined
  }

  // A logical-line anchor survives reflow; a marker on a removed wrapped row does not.
  private wrappedWidth(buffer: IBuffer, row: number) {
    const columns = this.terminal!.cols
    return buffer.getLine(row + 1)?.isWrapped && buffer.getLine(row + 1)?.getCell(0)?.getWidth() === 2
      && buffer.getLine(row)?.getCell(columns - 1)?.getCode() === 0
      && buffer.getLine(row)?.getCell(columns - 1)?.getWidth() === 1 ? columns - 1 : columns
  }

  private capture(region: Region) {
    const terminal = this.terminal!
    const buffer = terminal.buffer.normal
    const row = buffer.baseY + buffer.cursorY
    let anchor = row
    let offset = buffer.cursorX
    while (anchor > 0 && buffer.getLine(anchor)?.isWrapped) offset += this.wrappedWidth(buffer, --anchor)
    // Prompt redraws replace boundaries in the overwritten part of the buffer.
    for (const previous of [...this.boundaries].reverse()) {
      if (previous.marker.line < anchor || previous.marker.line === anchor && previous.offset < offset) break
      previous.marker.dispose()
    }
    const marker = terminal.registerMarker(anchor - row)
    if (!marker) return
    const cellMarker = row === anchor ? marker : terminal.registerMarker(0)
    if (!cellMarker) { marker.dispose(); return }
    const boundary = { marker, cellMarker, column: buffer.cursorX, fixed: false, offset, region }
    this.boundaries.add(boundary)
    marker.onDispose(() => {
      this.boundaries.delete(boundary)
      if (boundary.cellMarker !== marker) boundary.cellMarker.dispose()
    })
  }

  private position(boundary: Boundary): Position {
    if (boundary.fixed && !boundary.cellMarker.isDisposed)
      return { row: boundary.cellMarker.line, column: Math.min(boundary.column, this.terminal!.cols) }
    const buffer = this.terminal!.buffer.normal
    let row = boundary.marker.line
    let column = boundary.offset
    while (buffer.getLine(row + 1)?.isWrapped) {
      const width = this.wrappedWidth(buffer, row)
      if (column < width) break
      column -= width
      row++
    }
    return { row, column: Math.min(column, this.terminal!.cols) }
  }

  private updateFixedOffsets() {
    const buffer = this.terminal!.buffer.normal
    for (const boundary of this.boundaries) {
      if (!boundary.fixed || boundary.cellMarker.isDisposed) continue
      boundary.offset = Math.min(boundary.column, this.terminal!.cols)
      for (let row = boundary.marker.line; row < boundary.cellMarker.line; row++) boundary.offset += this.wrappedWidth(buffer, row)
    }
  }

  private resized() {
    const terminal = this.terminal!
    const buffer = terminal.buffer.normal
    let cursorAnchor = buffer.baseY + buffer.cursorY
    while (cursorAnchor > 0 && buffer.getLine(cursorAnchor)?.isWrapped) cursorAnchor--
    for (const boundary of this.boundaries) {
      // xterm leaves the cursor's logical line for readline/ZLE to redraw. Its physical
      // cells remain in place, while completed logical lines reflow to the new width.
      boundary.fixed = !terminal.options.reflowCursorLine && boundary.marker.line === cursorAnchor && !boundary.cellMarker.isDisposed
      if (boundary.fixed || terminal.buffer.active.type !== 'normal') continue
      const point = this.position(boundary)
      const marker = point.row === boundary.marker.line ? boundary.marker : terminal.registerMarker(point.row - buffer.baseY - buffer.cursorY)
      if (!marker) continue
      const previous = boundary.cellMarker
      boundary.cellMarker = marker
      boundary.column = point.column
      if (previous !== boundary.marker && previous !== marker) previous.dispose()
    }
    this.updateFixedOffsets()
    this.schedule()
  }

  private schedule() {
    if (this.frame !== undefined || !this.terminal) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.render()
    })
  }

  private clearDecorations() {
    for (const { decoration, marker } of this.decorations.values()) {
      decoration.dispose()
      marker.dispose()
    }
    this.decorations.clear()
  }

  private render() {
    const terminal = this.terminal!
    if (terminal.buffer.active.type !== 'normal' || !this.options.commands && !this.options.logs) {
      this.clearDecorations()
      return
    }
    const buffer = terminal.buffer.normal
    const top = buffer.viewportY
    const bottom = Math.min(buffer.length, top + terminal.rows)
    const colors = getTerminalHighlightColors(this.options.theme)
    const regions: Array<Position & { region: Region }> = []
    let initial: Region = 'output'
    for (const boundary of this.boundaries) {
      if (boundary.marker.line >= bottom) break
      const point = this.position(boundary)
      if (point.row < top - 8) initial = boundary.region
      else regions.push({ ...point, region: boundary.region })
    }
    // Include a short margin to recognize log words split across a soft wrap.
    const cells: Cell[] = []
    const characters: Array<Cell | undefined> = []
    let text = ''
    let region = initial
    let next = 0
    let draftBottom = buffer.baseY + buffer.cursorY
    while (buffer.getLine(draftBottom + 1)?.isWrapped) draftBottom++
    for (let row = Math.max(0, top - 8); row < Math.min(buffer.length, bottom + 8); row++) {
      const line = buffer.getLine(row)!
      if (row > Math.max(0, top - 8) && !line.isWrapped) { text += '\n'; characters.push(undefined) }
      const width = this.wrappedWidth(buffer, row)
      for (let column = 0; column < width; column++) {
        while (next < regions.length && (regions[next].row < row || regions[next].row === row && regions[next].column <= column)) region = regions[next++].region
        const source = line.getCell(column)!
        if (!source.getWidth()) continue
        const chars = source.getChars() || ' '
        const cell: Cell = { row, column, width: source.getWidth(), region,
          eligible: source.isFgDefault() && !source.isInvisible() && !source.isInverse() }
        if (region === 'command' && this.options.commands && row <= draftBottom && cell.eligible && source.getChars()) cell.color = colors.command
        cells.push(cell)
        text += chars
        for (let i = 0; i < chars.length; i++) characters.push(cell)
      }
    }
    if (this.options.logs) {
      for (const match of text.matchAll(/\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/g)) {
        const color = match[0] === 'ERROR' || match[0] === 'FATAL' ? colors.error
          : match[0] === 'WARN' || match[0] === 'WARNING' ? colors.warning
            : match[0] === 'INFO' ? colors.info : colors.muted
        for (let i = match.index; i < match.index + match[0].length; i++) {
          const cell = characters[i]
          if (cell?.region === 'output' && cell.eligible) cell.color = color
        }
      }
    }
    const runs: Array<Position & { width: number; color: string }> = []
    for (const cell of cells) {
      if (!cell.color || cell.row < top || cell.row >= bottom) continue
      const previous = runs.at(-1)
      if (previous?.row === cell.row && previous.column + previous.width === cell.column && previous.color === cell.color) previous.width += cell.width
      else runs.push({ row: cell.row, column: cell.column, width: cell.width, color: cell.color })
    }
    const keep = new Set<string>()
    for (const run of runs) {
      const key = `${run.row}:${run.column}:${run.width}:${run.color}`
      keep.add(key)
      const existing = this.decorations.get(key)
      if (existing && !existing.marker.isDisposed && existing.marker.line === run.row) continue
      existing?.decoration.dispose()
      existing?.marker.dispose()
      this.decorations.delete(key)
      const marker = terminal.registerMarker(run.row - buffer.baseY - buffer.cursorY)
      if (!marker) continue
      const decoration = terminal.registerDecoration({ marker, x: run.column, width: run.width, foregroundColor: run.color, layer: 'bottom' })
      if (decoration) this.decorations.set(key, { marker, decoration })
      else marker.dispose()
    }
    for (const [key, value] of this.decorations) {
      if (keep.has(key) && !value.marker.isDisposed) continue
      value.decoration.dispose()
      value.marker.dispose()
      this.decorations.delete(key)
    }
  }
}
