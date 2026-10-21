import type { Role } from '../types'

// Pixel art, two pixels per terminal cell: ▄ with fg = bottom and bg = top, since a terminal
// with line spacing shows a cell's background in a strip above the glyph, so the top color must own it.
const NONE = 0x01000000
const COLORS: Record<string, number> = {
  o: 0xd97757, // Claude orange
  r: 0xe5484d, // alarm body
  k: 0x1a1a1a, // eyes
  y: 0xf2c94c, // helmet, pencil
  w: 0xf2f2f2, // paper, bubbles
  g: 0x9aa0a6, // metal
  c: 0x56ccf2, // lens, sweat
  e: 0x3fb950, // green light
  b: 0x8b5a2b, // wood, hat
  B: 0x5c3a1e, // hat checks
  p: 0xff5f56, // red light
  d: 0x2b2d3a, // screen
}

// 24 x 12 pixels: hat room on top, body, arms, four legs, props room on the right.
// Eyes sit on pixel rows 6-7, one whole terminal row: split across two rows, a terminal with line spacing seams them.
const BASE = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....oooooooooooo....',
  '....oooooooooooo....',
  '....ookooooookoo....',
  '..ooookooooookoooo..',
  '....oooooooooooo....',
  '....oooooooooooo....',
  '.....o.o....o.o.....',
  '.....o.o....o.o.....',
].map(row => row.padEnd(24, '.'))
const STRIDE = '....o...o..o...o....'.padEnd(24, '.')
// Confetti spots (column, row) clear of the body, the raised arms and the arrow's column.
const CONFETTI = [[0, 0], [19, 1], [1, 3], [23, 4], [0, 5], [18, 0], [23, 0], [19, 4]] as const

const MINI_ART = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const MINI_STRIDE = '  ▝▘ ▝▘  '

export const BIG = { columns: 24, rows: 6 }
export const MINI = { columns: 9, rows: 3 }

// The hooks runtime has Uint8Array#toBase64 (the Raster docs use it); es2023's lib does not declare it.
const toBase64 = (words: Uint32Array) => (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()

type Glyph = { col: number; row: number; ch: string; fg: number; bg?: number }

// Standing roles keep their legs still: waiting on the person, startled by an Esc, or resting.
const isBusy = (role: Role) => !['idle', 'sleep', 'waiting', 'startled'].includes(role)

export function bigFrame(role: Role, frame: number, isAlarm: boolean): string {
  const grid = BASE.map(row => row.split(''))
  const glyphs: Glyph[] = []
  const px = (x: number, y: number, c: string) => {
    const row = grid[y]
    if (row && x >= 0 && x < row.length) row[x] = c
  }
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c)
  }
  const glyph = (col: number, row: number, ch: string, fg: string, bg?: string) =>
    glyphs.push({ col, row, ch, fg: COLORS[fg] ?? NONE, bg: bg ? COLORS[bg] : undefined })
  const phase = frame % 4

  if (isBusy(role) && frame % 2) grid[11] = STRIDE.split('')
  if (role !== 'sleep' && frame % 12 === 0) (px(6, 6, 'o'), px(13, 6, 'o'))

  switch (role) {
    case 'engineer': // hard hat and a swinging hammer
      rect(3, 3, 14, 1, 'y'), rect(5, 2, 10, 1, 'y'), rect(7, 1, 6, 1, 'y')
      if (phase < 2) rect(18, 4, 1, 3, 'b'), rect(17, 3, 3, 1, 'g')
      else rect(17, 8, 2, 1, 'b'), rect(19, 7, 1, 3, 'g')
      if (phase === 3) glyph(19, 5, '*', 'y')
      break
    case 'auditor': // glasses, a sheet and a pencil ticking items off
      rect(5, 6, 1, 2, 'g'), rect(7, 6, 1, 2, 'g'), rect(12, 6, 1, 2, 'g'), rect(14, 6, 1, 2, 'g'), rect(8, 6, 4, 1, 'g')
      rect(15, 6, 5, 6, 'w')
      for (let row = 3; row <= 5; row++) glyph(17, row, '─', 'g', 'w'), glyph(18, row, '─', 'g', 'w')
      for (let i = 0; i < phase; i++) glyph(16, 3 + i, '✓', 'e', 'w')
      {
        const x = 15 + (phase % 3)
        px(x, 5, 'k'), px(x + 1, 4, 'y'), px(x + 2, 3, 'y')
      }
      break
    case 'detective': { // checked deerstalker, a big magnifier sweeping over the eye like a monocle
      rect(4, 3, 12, 1, 'b')
      for (let i = 6; i <= 13; i++) px(i, 2, i % 2 ? 'b' : 'B')
      for (let i = 8; i <= 11; i++) px(i, 1, i % 2 ? 'B' : 'b')
      const x = [11, 12, 13, 12][(frame >> 1) % 4] ?? 12
      rect(x + 1, 4, 2, 1, 'g'), rect(x + 1, 7, 2, 1, 'g'), rect(x, 5, 1, 2, 'g'), rect(x + 3, 5, 1, 2, 'g')
      rect(x + 1, 5, 2, 2, 'c'), px(x + 1, 5, 'w')
      px(x + 4, 8, 'b'), px(x + 5, 9, 'b')
      break
    }
    case 'operator': // laptop with a blinking prompt
      rect(14, 6, 6, 4, 'd'), rect(13, 10, 7, 1, 'g')
      glyph(15, 3, '>', 'e', 'd')
      if (phase < 2) glyph(16, 3, '_', 'e', 'd')
      for (let i = 0; i <= phase; i++) glyph(15 + i, 4, '-', 'g', 'd')
      break
    case 'explorer': // antenna sending signals
      rect(9, 1, 1, 3, 'g'), px(9, 0, frame % 2 ? 'p' : 'e')
      if (phase >= 1) glyph(11, 0, ')', 'c'), glyph(7, 0, '(', 'c')
      if (phase >= 2) glyph(12, 0, ')', 'c'), glyph(6, 0, '(', 'c')
      break
    case 'director': { // megaphone calling out, waves rolling, a mini Clawd marching in step
      px(16, 6, 'g'), rect(17, 5, 1, 3, 'g'), rect(18, 4, 1, 5, 'g'), px(18, 6, 'w')
      for (let i = 0; i < phase; i++) glyph(19 + i, 3, ')', 'y')
      const y = frame % 2 ? 9 : 10
      rect(0, y, 3, 1, 'o'), px(0, y + 1, 'o'), px(2, y + 1, 'o')
      break
    }
    case 'whipper': { // subagents or tasks at work: the right arm cocks the whip back, then lashes it out to the right
      px(16, 7, '.'), px(17, 7, '.')
      if (phase === 0) {
        px(16, 6, 'o'), px(17, 5, 'o'), px(17, 4, 'o'), px(18, 3, 'b'), px(19, 2, 'b'), px(20, 1, 'b'), px(21, 1, 'b'), px(22, 2, 'b')
      } else if (phase === 1) {
        px(16, 6, 'o'), px(17, 5, 'o'), px(18, 5, 'b'), px(19, 4, 'b'), px(20, 4, 'b'), px(21, 5, 'b'), px(22, 6, 'b')
      } else if (phase === 2) {
        px(16, 7, 'o'), px(17, 7, 'o'), rect(18, 7, 6, 1, 'b'), glyph(23, 2, '*', 'y'), glyph(22, 2, '·', 'y')
      } else {
        px(16, 7, 'o'), px(17, 7, 'o'), px(18, 8, 'b'), px(19, 9, 'b'), px(20, 9, 'b'), px(21, 8, 'b')
      }
      break
    }
    case 'thinker': // eyes up to a cloud where the idea forms: . .. ... then !
      px(6, 7, 'o'), px(13, 7, 'o')
      rect(15, 0, 5, 2, 'w'), px(14, 2, 'w')
      if (phase === 3) glyph(17, 0, '!', 'p', 'w')
      else for (let i = 0; i <= phase; i++) glyph(16 + i, 0, '.', 'k', 'w')
      break
    case 'shipper': { // pushed: hops with both arms up while an arrow flies up and confetti falls
      px(2, 7, '.'), px(3, 7, '.'), px(16, 7, '.'), px(17, 7, '.')
      px(3, 6, 'o'), px(2, 5, 'o'), px(2, 4, 'o'), px(16, 6, 'o'), px(17, 5, 'o'), px(17, 4, 'o')
      if (phase === 1 || phase === 2) grid.push(...grid.splice(0, 2))
      const y = 5 - (frame % 6)
      glyph(21, y, '▲', 'e')
      if (y < 5) glyph(21, y + 1, '│', 'g')
      CONFETTI.forEach(([col, row], i) => (i + frame) % 3 === 0 && glyph(col, row, '*+·'[i % 3] ?? '*', 'ywcp'[i % 4] ?? 'y'))
      break
    }
    case 'waiting': { // a permission dialog is up: one hand raised and waving, a blinking question mark
      px(16, 7, '.'), px(17, 7, '.'), px(16, 6, 'o'), px(17, 5, 'o'), px(17, 4, 'o')
      px(frame % 2 ? 18 : 17, 3, 'o')
      if (phase < 2) glyph(20, 1, '?', 'y')
      break
    }
    case 'compactor': { // compacting the context: two arrows close in and squeeze it two pixels flat
      const isSqueezed = phase === 1 || phase === 2
      if (isSqueezed) grid.splice(8, 2), grid.unshift([...BASE[0]!], [...BASE[0]!])
      glyph(isSqueezed ? 1 : 0, 3, '▶', 'c'), glyph(isSqueezed ? 18 : 19, 3, '◀', 'c')
      break
    }
    case 'startled': // interrupted: eyes wide open, an exclamation mark jumps over the head
      px(5, 6, 'w'), px(5, 7, 'w'), px(7, 6, 'w'), px(7, 7, 'w')
      px(12, 6, 'w'), px(12, 7, 'w'), px(14, 6, 'w'), px(14, 7, 'w')
      glyph(10, phase < 2 ? 0 : 1, '!', 'p')
      break
    case 'sleep': {
      px(6, 6, 'o'), px(13, 6, 'o')
      const slow = (frame >> 2) % 4
      if (slow >= 1) glyph(15, 1, 'z', 'w')
      if (slow >= 2) glyph(16, 0, 'Z', 'w')
      if (slow >= 3) glyph(18, 0, 'z', 'w')
      break
    }
    case 'idle': // every third cycle the arm stub slides up and back: a solid block, no gap to read as an eye
      if ((frame >> 2) % 3 === 0 && phase !== 0) {
        const y = phase === 2 ? 5 : 6
        px(2, 7, '.'), px(3, 7, '.'), px(2, y, 'o'), px(3, y, 'o')
      }
      break
  }

  if (isAlarm) {
    for (const row of grid) row.forEach((c, i) => c === 'o' && (row[i] = 'r'))
    px(3, 3 + phase, 'c')
  }

  return encode(grid, glyphs)
}

export function miniFrame(role: Role, frame: number, isAlarm: boolean): string {
  const rows = MINI_ART.map(row => [...row])
  const eyes = rows[0]
  if (eyes && (role === 'sleep' || frame % 12 === 0)) (eyes[2] = '█'), (eyes[6] = '█')
  if (isBusy(role) && frame % 2) rows[2] = [...MINI_STRIDE]
  if (eyes && role === 'shipper') (eyes[0] = frame % 2 ? '*' : ' '), (eyes[8] = frame % 2 ? ' ' : '*')
  if (eyes && (role === 'waiting' || role === 'startled') && frame % 2) eyes[8] = role === 'waiting' ? '?' : '!'
  if (eyes && role === 'whipper') eyes[8] = ['~', '≈', '—', '~'][frame % 4] ?? '~'
  if (eyes && role === 'compactor') (eyes[0] = '▸'), (eyes[8] = '◂')
  const fg = isAlarm ? COLORS.r! : COLORS.o!
  const words = new Uint32Array(MINI.columns * MINI.rows * 3)
  rows.forEach((row, r) =>
    row.forEach((ch, c) => words.set([ch.codePointAt(0) ?? 0x20, fg, NONE], (r * MINI.columns + c) * 3)),
  )
  return toBase64(words)
}

// A background task's icon: the 3-row mini Clawd at work, its tool on the top row beside it. It marches and
// waves for a subagent, types (arms in turn) for a shell, glances up at its waves for a monitor, else walks.
export const TASK_ICON = { columns: MINI.columns + 3, rows: MINI.rows }
const SPIN = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
export function taskIcon(kind: string, frame: number): string {
  const step = (frame >> 1) % 2
  const [head = [], arms = [], legs = []] = MINI_ART.map(row => [...row])
  if (kind === 'shell') (arms[0] = step ? '▗' : '▝'), (arms[8] = step ? '▘' : '▖')
  else if (kind === 'monitor') step && ((head[2] = '▙'), (head[6] = '▟'))
  else if (step) {
    legs.splice(0, legs.length, ...MINI_STRIDE)
    if (kind === 'subagent') (arms[8] = ' '), (head[8] = '▖')
  }
  if (frame % 12 === 0) (head[2] = '█'), (head[6] = '█')
  const [prop, fg] =
    kind === 'subagent'
      ? [['  ', '› ', '»›'][(frame >> 1) % 3] ?? '  ', COLORS.o!]
      : kind === 'shell'
        ? [`$${SPIN[frame % SPIN.length]}`, COLORS.e!]
        : kind === 'monitor'
          ? [['◉ ', '◉)'][step] ?? '◉ ', COLORS.c!]
          : [`${['◐', '◓', '◑', '◒'][frame % 4] ?? '◐'} `, COLORS.y!]
  const words = new Uint32Array(TASK_ICON.columns * TASK_ICON.rows * 3)
  const put = (r: number, c: number, ch: string, color: number) =>
    words.set([ch.codePointAt(0) ?? 0x20, color, NONE], (r * TASK_ICON.columns + c) * 3)
  for (let r = 0; r < TASK_ICON.rows; r++) for (let c = 0; c < TASK_ICON.columns; c++) put(r, c, ' ', NONE)
  ;[head, arms, legs].forEach((row, r) => row.forEach((ch, c) => put(r, c, ch, COLORS.o!)))
  ;[...prop.padEnd(2)].slice(0, 2).forEach((ch, c) => put(0, MINI.columns + 1 + c, ch, fg))
  return toBase64(words)
}

function encode(grid: string[][], glyphs: Glyph[]): string {
  const columns = grid[0]?.length ?? 0
  const rows = grid.length / 2
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = COLORS[grid[2 * r]?.[c] ?? '.']
      const bottom = COLORS[grid[2 * r + 1]?.[c] ?? '.']
      const cell =
        top !== undefined && top === bottom
          ? [0x20, NONE, top]
          : top !== undefined && bottom !== undefined
            ? [0x2584, bottom, top]
            : top !== undefined
              ? [0x2580, top, NONE]
              : bottom !== undefined
                ? [0x2584, bottom, NONE]
                : [0x20, NONE, NONE]
      words.set(cell, (r * columns + c) * 3)
    }
  }
  for (const g of glyphs) words.set([g.ch.codePointAt(0) ?? 0x20, g.fg, g.bg ?? NONE], (g.row * columns + g.col) * 3)
  return toBase64(words)
}

// Gauge: a dark track filled in eighths of a cell, colored by position from green through amber to red.
const TRACK = 0x30363d
const MARK = 0xe6edf3
const EIGHTHS = ' ▏▎▍▌▋▊▉'

const mix = (a: number, b: number, t: number) =>
  [16, 8, 0].reduce((rgb, s) => rgb | (Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s), 0)
const heat = (x: number) => (x < 0.6 ? mix(0x3fb950, 0xd29922, x / 0.6) : mix(0xd29922, 0xf85149, (x - 0.6) / 0.4))

export function gaugeCells(pct: number, columns: number, mark?: number): string {
  const words = new Uint32Array(columns * 3)
  const filled = (Math.min(100, Math.max(0, pct)) / 100) * columns
  const markAt = mark === undefined ? -1 : Math.min(columns - 1, Math.floor((mark / 100) * columns))
  for (let c = 0; c < columns; c++) {
    const color = heat((c + 0.5) / columns)
    const eighths = Math.round((filled - c) * 8)
    let cell =
      eighths >= 8 ? [0x20, NONE, color] : eighths > 0 ? [EIGHTHS.codePointAt(eighths) ?? 0x20, color, TRACK] : [0x20, NONE, TRACK]
    if (c === markAt) cell = [0x258f, MARK, eighths >= 4 ? color : TRACK]
    words.set(cell, c * 3)
  }
  return toBase64(words)
}
