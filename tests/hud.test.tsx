import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { FIVE_HOURS, WEEK, fmtDur, windowInfo } from '../hooks/format'
import { bigFrame } from '../hooks/sprites'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-19T14:00:00Z')
const USAGE = {
  startedAt: NOW - HOUR,
  context: { tokens: 88_000, window: 200_000, percent: 44 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 58, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 21, resetsAt: new Date(NOW + 76 * HOUR).toISOString() },
  ],
  cost: { usd: 3.42 },
}
const BAND = {
  plugin: 'clawd-hud',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const NARROW = { ...BAND, props: { ...BAND.props, bodyColumns: 80 } } as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
function engine(on: On) {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
}

test('windowInfo projects the window and places the marker', () => {
  // 3h into the 5h window at 75%: 25%/h, so 100% one hour from now, before the reset.
  const hot = windowInfo(75, NOW + 2 * HOUR, NOW, FIVE_HOURS)
  expect(Math.round(hot.perHour ?? 0)).toBe(25)
  expect(Math.round(hot.eta ?? 0)).toBe(NOW + HOUR)
  expect(Math.round(hot.elapsedPct)).toBe(60)
  // 3h in at 45%: 15%/h lasts until the reset.
  expect(windowInfo(45, NOW + 2 * HOUR, NOW, FIVE_HOURS).eta).toBeUndefined()
  // 7d at 20% with 4 days left: 80% over 4 days is 20% a day.
  expect(Math.round(windowInfo(20, NOW + 96 * HOUR, NOW, WEEK).perDayLeft ?? 0)).toBe(20)
  expect(fmtDur(2 * HOUR + 14 * 60_000)).toBe('2h14m')
  expect(fmtDur(76 * HOUR)).toBe('3d 4h')
})

test('an Edit makes Clawd the engineer, above the prompt beside every KPI', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/app.tsx', old_string: 'a', new_string: 'b' })

  // The mock clock never ticks, so the mascot stays on frame 0.
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'clawd' }))?.props.cells).toBe(bigFrame('engineer', 0, false))
  expect(await ui.find({ type: 'Text', text: /app\.tsx/ })).toBeUndefined()
  for (const kpi of [/58%/, /42% libre/, /Holgado|Acelerado/, /Contexto/, /112k libres/, /Tokens/, /\$3\.42/, /1 ediciones/]) {
    expect(await ui.find({ type: 'Text', text: kpi })).toBeDefined()
  }
  await ui.unmount()
})

test('a review skill makes Clawd the auditor; the narrow band shows the KPIs on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Skill', skill: 'code-review' })
  const wide = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await wide.find({ key: 'clawd' }))?.props.cells).toBe(bigFrame('auditor', 0, false))
  await wide.unmount()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...NARROW, surface })
    expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/hud hides the band and shows it again', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const hud = { command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as const
  expect((await $.command.run(hud))?.text).toContain('oculto')
  expect((await $.command.run(hud))?.text).toContain('visible')
})
