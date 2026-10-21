import { expect, mock, test } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import { FIVE_HOURS, elapsedPct, fmtDur } from '../hooks/format'
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
function engine(on: On, whileCalling = async (): Promise<ToolCallResult | void> => {}) {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: '/Users/neo/Clawd---Claude-bot' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', async () => (await whileCalling()) ?? { result: {} })
}

test('elapsedPct places the marker', () => {
  // 3h into the 5h window: an even pace would sit at 60%.
  expect(Math.round(elapsedPct(NOW + 2 * HOUR, NOW, FIVE_HOURS))).toBe(60)
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
  for (const kpi of [/58%/, /42% left/, /Context/, /112k left/, /Tokens/, /\$3\.42/, /1 edits/]) {
    expect(await ui.find({ type: 'Text', text: kpi })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /%\/h|%\/day/ })).toBeUndefined()
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
    expect(await ui.find({ type: 'Text', text: /Context/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the model row shows the model and the effort of the last main-loop request', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /effort/ })).toBeUndefined()
  await ui.unmount()

  // A subagent's request does not change what the main loop runs at.
  for (const step of [
    { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 },
    { turnId: 'a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'x' },
  ] as const) {
    for await (const _ of $.turn.step(step));
  }
  for (const band of [BAND, NARROW]) {
    const ui = await $.ui.mount({ ...band, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /effort xhigh/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a running call captions Clawd and the border takes its role color', async ($, on) => {
  let caption: unknown
  let border: unknown
  engine(on, async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    caption = await ui.find({ type: 'Text', text: /⏵ Bash · 0s/ })
    border = (await ui.find({ key: 'card' }))?.props.borderColor
    await ui.unmount()
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(caption).toBeDefined()
  expect(border).toBe('bashBorder')

  // Done, the caption goes; the operator's border stays until the next role.
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⏵/ })).toBeUndefined()
  expect((await ui.find({ key: 'card' }))?.props.borderColor).toBe('bashBorder')
  await ui.unmount()
})

test('a successful push makes Clawd celebrate and names the repository, never the URL', async ($, on) => {
  const stderr = 'To https://user:secret@github.com/johnCasana/Clawd---Claude-bot.git\n   357cb67..b661cca  main -> main\n'
  engine(on, async () => ({ result: { stdout: '', stderr, interrupted: false, gitOperation: { push: { branch: 'main' } } } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'clawd' }))?.props.cells).toBe(bigFrame('shipper', 0, false))
  expect((await ui.find({ key: 'card' }))?.props.borderColor).toBe('success')
  expect(await ui.find({ type: 'Text', text: /^~\/Clawd---Claude-bot$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↑ main → johnCasana\/Clawd---Claude-bot · 0s ago/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /secret|https/ })).toBeUndefined()
  await ui.unmount()
})

test('/hud hides the band and shows it again', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const hud = { command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as const
  expect((await $.command.run(hud))?.text).toContain('hidden')
  expect((await $.command.run(hud))?.text).toContain('shown')
})
