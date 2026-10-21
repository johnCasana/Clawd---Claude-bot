import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage, ToolCallInput, ToolCallResult } from 'claude-code'

import { FIVE_HOURS, elapsedPct, fmtDur } from '../hooks/format'
import { bigFrame, taskIcon } from '../hooks/sprites'

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
function engine(on: On, whileCalling = async (_: ToolCallInput): Promise<ToolCallResult | void> => {}) {
  const clock = mock.clock(on, { now: NOW })
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
  on('classic.Stop', () => ({}))
  on('tool.call', async (_, e) => (await whileCalling(e)) ?? { result: {} })
  on('turn.complete', () => ({ text: '' }))
  // The engine's own drawing of the two rows the HUD reads.
  on('ui.render', { component: 'ToolProgress' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const toasts: string[] = []
  const sounds: unknown[] = []
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('audio.play', (_, e) => (sounds.push(e.clip), { value: undefined }))

  return { clock, toasts, sounds }
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

test('background work gets a column with an icon per task; the list at Stop is the record', async ($, on) => {
  const WIDE = { ...BAND, props: { ...BAND.props, bodyColumns: 160 } } as const
  const { clock } = engine(on, async () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Dev server', run_in_background: true })

  let ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Background/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeDefined()
  expect((await ui.find({ key: 'bg-0' }))?.props.cells).toBe(taskIcon('shell', 0))
  await ui.unmount()

  // Too narrow for the column: the session row counts the tasks.
  ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⧗ 1 in background/ })).toBeDefined()
  await ui.unmount()

  // Its end's notification row takes it off at once, without waiting for Stop; a row that ends nothing keeps it.
  const notify = async (task: { id: string; status?: string }) => {
    const row = await $.ui.mount({
      plugin: 'clawd-hud',
      surface: 'terminal',
      component: 'UserMessage',
      props: { text: 'Dev server', origin: { kind: 'task-notification' }, isExpanded: false, task },
    })
    await row.unmount()
    await clock.settle()
  }
  await notify({ id: 'b1' })
  ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeDefined()
  await ui.unmount()
  await notify({ id: 'b1', status: 'completed' })
  ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Background/ })).toBeUndefined()
  await ui.unmount()

  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'a1', type: 'subagent', status: 'running', description: 'Review auth' },
      { id: 'm1', type: 'monitor', status: 'running', description: 'Watch logs' },
      { id: 'w1', type: 'workflow', status: 'running', description: 'Release' },
    ],
  })
  // Each task is a 3-row Clawd: two fit, the rest are counted.
  ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Review auth/ })).toBeDefined()
  expect((await ui.find({ key: 'bg-0' }))?.props.cells).toBe(taskIcon('subagent', 0))
  expect((await ui.find({ key: 'bg-1' }))?.props.cells).toBe(taskIcon('monitor', 0))
  expect(await ui.find({ type: 'Text', text: /Release/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+1 more/ })).toBeDefined()
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Background/ })).toBeUndefined()
  await ui.unmount()
})

test('a permission ask raises a hand until the allowed call runs', async ($, on) => {
  const seen: unknown[] = []
  const look = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    seen.push((await ui.find({ key: 'clawd' }))?.props.cells, (await ui.find({ key: 'card' }))?.props.borderColor)
    await ui.unmount()
  }
  const { clock } = engine(on, async e => {
    await $.tool.check({ tool: 'Bash', input: { command: 'npm run build' }, tool_use_id: e.tool_use_id })
    await look()
    // Allowed and still running: the run-in-background pill shows under it.
    const pill = await $.ui.mount({
      plugin: 'clawd-hud',
      surface: 'terminal',
      component: 'ToolProgress',
      requestId: e.tool_use_id,
      props: { tool_use_id: e.tool_use_id, kind: 'background_hint', hint: '(ctrl+b to run in background)' },
    })
    await pill.unmount()
    await clock.settle()
    await look()
  })
  on('tool.check', () => ({ decision: 'ask' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(seen).toEqual([bigFrame('waiting', 0, false), 'warning', bigFrame('operator', 0, false), 'bashBorder'])
})

const SUMMARY: SessionMessage = { role: 'user', text: 'Summary', toolUses: [] }

test('compacting squeezes Clawd, then it goes back to what it was doing', async ($, on) => {
  let cells: unknown
  engine(on)
  on('session.compact', async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    cells = (await ui.find({ key: 'clawd' }))?.props.cells
    await ui.unmount()
    return { messages: [SUMMARY] }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
  expect(cells).toBe(bigFrame('compactor', 0, false))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'clawd' }))?.props.cells).toBe(bigFrame('detective', 0, false))
  await ui.unmount()
})

test('the context warning shows once per fill', async ($, on) => {
  const { toasts } = engine(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const measure = (percent: number) =>
    $.session.measure({ context: { tokens: percent * 2_000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
  await measure(82)
  await measure(85)
  expect(toasts.filter(t => /Context at/.test(t))).toEqual(['⚠ Context at 82% · /compact frees it'])

  // A compaction frees the window: the next fill warns again.
  await measure(30)
  await measure(81)
  expect(toasts.filter(t => /Context at/.test(t))).toHaveLength(2)
})

test('an Esc startles Clawd for a moment; any other end of a long turn chimes', async ($, on) => {
  const { clock, sounds } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const end = (isAborted: boolean, durationMs = 30_000) =>
    $.turn.complete({ answer: '', durationMs, isAborted, turnId: 't', reason: isAborted ? 'aborted' : 'answer' })

  await end(true)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'clawd' }))?.props.cells).toBe(bigFrame('startled', 0, false))
  await ui.unmount()
  expect(sounds).toEqual([])

  await clock.advance(3_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'card' }))?.props.borderColor).toBe('claude')
  await ui.unmount()

  // A quick answer was watched as it ended: only the long one chimes.
  await end(false, 2_000)
  await end(false)
  await clock.settle()
  expect(sounds).toEqual([{ asset: 'sounds/done.wav' }])
})

test('/hud hides the band and shows it again', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const hud = { command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as const
  expect((await $.command.run(hud))?.text).toContain('hidden')
  expect((await $.command.run(hud))?.text).toContain('shown')
})

test('Clawd cracks the whip while a subagent or task works', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'Review auth' }],
  })

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tlabajal/ })).toBeUndefined()
  await ui.unmount()

  // Now and then he shouts: two seconds of every nine.
  await clock.advance(7_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tlabajal, tu tenel/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /que tlabajal/ })).toBeDefined()
  await ui.unmount()
})
