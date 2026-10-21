import { atom, read, update } from 'claude-code'
import type {
  BuiltinToolResults,
  EngineInterface,
  Register,
  RenderInput,
  SessionRateLimit,
  ThemeKey,
  Timer,
} from 'claude-code'

import type { Activity, Role, Task } from '../types'
import { FIVE_HOURS, WEEK, elapsedPct, fmtDur, fmtTokens, fmtWhen, tone } from './format'
import { BIG, MINI, bigFrame, gaugeCells, miniFrame, taskIcon } from './sprites'

const SLEEP_AFTER = 60_000
const CELEBRATE = 8_000
// The background column's width, shown from BG_MIN_WIDTH columns; below, the session row counts the tasks.
const BG_COLS = 34
const BG_MIN_WIDTH = 150
const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/
const REVIEW = /review|audit|revis|security/i
// The card's border takes the role's color; the operator matches the Bash prompt's border.
const ROLE_COLORS: Record<Role, ThemeKey> = {
  engineer: 'claude',
  auditor: 'merged',
  detective: 'ide',
  operator: 'bashBorder',
  explorer: 'planMode',
  director: 'permission',
  thinker: 'remember',
  shipper: 'success',
  idle: 'claude',
  sleep: 'subtle',
}

const now = atom({ plugin: 'clawd-hud', key: 'now' } as const, 0)
const activity = atom({ plugin: 'clawd-hud', key: 'activity' } as const, { role: 'idle', since: 0 })
const tokens = atom({ plugin: 'clawd-hud', key: 'tokens' } as const, { input: 0, output: 0 })
const cached = atom({ plugin: 'clawd-hud', key: 'cached' } as const, 0)
// The main loop's calls in flight; the newest is captioned with its elapsed time.
const running = atom({ plugin: 'clawd-hud', key: 'running' } as const, [])
const push = atom({ plugin: 'clawd-hud', key: 'push' } as const, null)
const tasks = atom({ plugin: 'clawd-hud', key: 'tasks' } as const, [])
const counts = atom({ plugin: 'clawd-hud', key: 'counts' } as const, { edits: 0, commands: 0, tools: 0 })
const effort = atom({ plugin: 'clawd-hud', key: 'effort' } as const, null)
const warned = atom({ plugin: 'clawd-hud', key: 'warned' } as const, [])
const isHidden = atom({ plugin: 'clawd-hud', key: 'isHidden' } as const, false)

const windowName = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind)
const isHot = (limits: readonly SessionRateLimit[]) => limits.some(r => r.percentUsed >= 90)
// Cut to n columns ourselves: a row whose text overflows next to a Raster wraps to two rows, truncated or not.
const clip = (text: string, n: number) => ([...text].length <= n ? text : [...text].slice(0, Math.max(0, n - 1)).join('') + '…')
// A path keeps its tail, where the folder's own name is.
function tail(text: string, n: number) {
  const chars = [...text]
  return chars.length <= n ? text : '…' + chars.slice(chars.length - n + 1).join('')
}
// Clawd stays awake while background work runs.
const shownRole = (a: Activity, at: number): Role =>
  at - pushedAt < CELEBRATE
    ? 'shipper'
    : a.role === 'idle' && at - a.since > SLEEP_AFTER && taskCount === 0
      ? 'sleep'
      : a.role

function classify(e: Record<string, unknown>): Role {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  if (EDIT_TOOLS.test(tool)) return 'engineer'
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
      return 'detective'
    case 'Bash':
      return 'operator'
    case 'WebSearch':
    case 'WebFetch':
      return 'explorer'
    case 'Agent':
      return REVIEW.test(`${s('subagent_type')} ${s('description')}`) ? 'auditor' : 'director'
    case 'Skill':
      return REVIEW.test(s('skill')) ? 'auditor' : 'thinker'
    default:
      return tool.startsWith('mcp__') ? 'explorer' : 'thinker'
  }
}

// Module copies the 200 ms animation reads without awaiting state.
let act: Activity = { role: 'idle', since: 0 }
let clockNow = 0
let isAlarm = false
let frame = 0
let bandId: string | undefined
let isBandWide = false
let agentsRunning = 0
let callsRunning = 0
let pushedAt = -Infinity
let taskCount = 0
// The kinds of the task rows drawn with an icon, in order: the animation blits `bg-<i>`.
let bgKinds: string[] = []
let timers: Timer[] = []

async function setActivity($: EngineInterface, role: Role) {
  act = { role, since: await $.clock.now() }
  await update($, activity, () => act)
}

async function refresh($: EngineInterface) {
  clockNow = await $.clock.now()
  await update($, now, () => clockNow)
}

async function setTasks($: EngineInterface, fn: (t: Task[]) => Task[]) {
  taskCount = (await update($, tasks, fn)).length
}

async function addTask($: EngineInterface, task: Omit<Task, 'since'>) {
  const since = await $.clock.now()
  await setTasks($, t => [...t.filter(x => x.id !== task.id), { ...task, since }])
}

// A push the engine recognized: Clawd celebrates and the Path row names where it went.
async function celebrate($: EngineInterface, out: BuiltinToolResults['Bash']) {
  const text = `${out.stdout}\n${out.stderr}`
  if (/Everything up-to-date/.test(text)) return
  // Owner and repository only: a remote URL may carry credentials.
  const repo = text.match(/^To (\S+)/m)?.[1]?.replace(/\.git$/, '').match(/[^/:]+\/[^/:]+$/)?.[0] ?? ''
  pushedAt = await $.clock.now()
  await update($, push, () => ({ repo, branch: out.gitOperation?.push?.branch ?? '', at: pushedAt }))
  await refresh($)
  $.clock.after(CELEBRATE, () => void refresh($))
}

function animate($: EngineInterface) {
  frame += 1
  if (!bandId) return
  const role = shownRole(act, clockNow)
  const cells = isBandWide ? bigFrame(role, frame, isAlarm) : miniFrame(role, frame, isAlarm)
  void $.ui.blit({ requestId: bandId, key: isBandWide ? 'clawd' : 'clawd-mini', cells })
  bgKinds.forEach((kind, i) => void $.ui.blit({ requestId: bandId!, key: `bg-${i}`, cells: taskIcon(kind, frame) }))
}

async function draw($: EngineInterface, e: RenderInput<'AbovePrompt'>, isWide: boolean, width: number) {
  const { Box, Text } = $.ui.resolve(e)
  const [at, a, tok, cache, calls, pushed, bg, cnt, eff, cwd, model, usage] = await Promise.all([
    read($, now),
    read($, activity),
    read($, tokens),
    read($, cached),
    read($, running),
    read($, push),
    read($, tasks),
    read($, counts),
    read($, effort),
    $.session.cwd(),
    $.session.model(),
    $.session.usage(),
  ])
  const path = cwd.replace(/^(\/(Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')
  const pushText = pushed
    ? `  ↑ ${[pushed.branch, pushed.repo].filter(Boolean).join(' → ')} · ${fmtDur(at - pushed.at)} ago`
    : ''
  const role = shownRole(a, at)
  const call = calls[calls.length - 1]
  const doing = call ? `⏵ ${call.tool.replace(/^mcp__.*__/, '')} · ${fmtDur(at - call.since)}` : ''
  // The wide terminal card captions Clawd with the call; elsewhere it follows the model.
  const isCaptioned = isWide && e.surface === 'terminal'
  const effortText = (eff === null ? '' : ` · effort ${eff}`) + (doing && !isCaptioned ? `  ${doing}` : '')
  const cachedText = tok.input ? ` · ${Math.round((cache / tok.input) * 100)}% cached` : ''
  const five = usage.rateLimits.find(r => r.kind === 'five_hour')
  const seven = usage.rateLimits.find(r => r.kind === 'seven_day')
  const mark = (r: SessionRateLimit | undefined, span: number) =>
    r?.resetsAt ? elapsedPct(Date.parse(r.resetsAt), at, span) : undefined
  const m5 = mark(five, FIVE_HOURS)
  const m7 = mark(seven, WEEK)
  const ctx = usage.context
  const hours = (at - usage.startedAt) / 3_600_000
  const cost = usage.cost ? `$${usage.cost.usd.toFixed(2)}` : '—'
  const costRate = usage.cost && hours >= 0.1 ? ` · $${(usage.cost.usd / hours).toFixed(2)}/h` : ''
  const hasBgColumn = isWide && bg.length > 0 && width >= BG_MIN_WIDTH
  // Eight rows: the title and seven tasks, or six and a count of the rest.
  const bgShown = bg.length > 7 ? bg.slice(0, 6) : bg
  bgKinds = hasBgColumn && e.surface === 'terminal' ? bgShown.map(t => t.kind) : []
  const bgNote = bg.length && !hasBgColumn ? ` · ⧗ ${bg.length} in background` : ''
  const session = `${fmtDur(at - usage.startedAt)} · ${cnt.edits} edits · ${cnt.commands} commands · ${cnt.tools} tools${bgNote}`
  const pctText = (pct?: number) => (
    <Text bold color={pct === undefined ? 'subtle' : tone(pct)}>
      {pct === undefined ? '  —' : `${Math.round(pct)}%`.padStart(4)}
    </Text>
  )
  const gauge = (key: string, pct: number | undefined, columns: number, mark?: number) => {
    const p = pct ?? 0
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      return <Raster key={key} columns={columns} rows={1} cells={gaugeCells(p, columns, mark)} />
    }
    const fill = Math.round((Math.min(100, p) / 100) * columns)
    return (
      <Text color={tone(p)}>
        {'█'.repeat(fill)}
        <Text dimColor>{'░'.repeat(columns - fill)}</Text>
      </Text>
    )
  }

  let art
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    art = isWide ? (
      <Box flexDirection="column" alignItems="center" width={BIG.columns}>
        <Raster key="clawd" columns={BIG.columns} rows={BIG.rows} cells={bigFrame(role, frame, isAlarm)} />
        <Text color={ROLE_COLORS[role]}>{clip(doing, BIG.columns)}</Text>
      </Box>
    ) : (
      <Raster key="clawd-mini" columns={MINI.columns} rows={MINI.rows} cells={miniFrame(role, frame, isAlarm)} />
    )
  }

  if (!isWide) {
    const chip = (label: string, key: string, pct?: number, mark?: number, resetsAt?: string) => (
      <Box flexDirection="row" gap={1}>
        <Text bold>{label}</Text>
        {gauge(key, pct, 10, mark)}
        {pctText(pct)}
        {resetsAt ? <Text dimColor>↻{fmtDur(Date.parse(resetsAt) - at)}</Text> : undefined}
      </Box>
    )
    return (
      <Box flexDirection="row" gap={1}>
        {art}
        <Box flexDirection="column" flexShrink={1}>
          <Box flexDirection="row" columnGap={3} flexWrap="wrap">
            {chip('5h', 'b5', five?.percentUsed, m5, five?.resetsAt)}
            {chip('7d', 'b7', seven?.percentUsed, m7, seven?.resetsAt)}
            {chip('Context', 'bc', ctx.percent)}
          </Box>
          <Text wrap="truncate-end">
            <Text bold>{model}</Text>
            <Text dimColor>{`${effortText}  ${path}`}</Text>
            <Text color="success">{pushText}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {fmtTokens(tok.input)} input · {fmtTokens(tok.output)} output{cachedText} · {cost}
            {costRate} · {session}
          </Text>
        </Box>
      </Box>
    )
  }

  const taskMark = (kind: string, i: number) => {
    if (e.surface !== 'terminal') return <Text color="claude">•</Text>
    const { Raster } = $.ui.resolve(e)
    return <Raster key={`bg-${i}`} columns={3} rows={1} cells={taskIcon(kind, frame)} />
  }

  // Beside the mascot, inside the round border and its padding, after the label column.
  const textCols = width - 4 - BIG.columns - 2 - 9 - 1 - (hasBgColumn ? BG_COLS + 2 : 0)
  const barCols = Math.max(12, Math.min(22, Math.floor(textCols * 0.25)))
  const label = (text: string) => <Text bold>{text.padEnd(8)}</Text>
  const meter = (name: string, key: string, pct: number | undefined, mark: number | undefined, detail: string) => (
    <Box flexDirection="row" gap={1}>
      {label(name)}
      {gauge(key, pct, barCols, mark)}
      <Text wrap="truncate-end">
        {pctText(pct)}
        <Text dimColor>{clip(`  ${detail}`, textCols - barCols - 1 - 4)}</Text>
      </Text>
    </Box>
  )
  const reset = (r?: SessionRateLimit) =>
    r?.resetsAt
      ? `${Math.max(0, Math.round(100 - r.percentUsed))}% left · ↻ ${fmtWhen(Date.parse(r.resetsAt), at)} (${fmtDur(Date.parse(r.resetsAt) - at)})`
      : ''
  const ctxDetail =
    ctx.tokens === undefined
      ? `${fmtTokens(ctx.window)} window`
      : `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)} · ${fmtTokens(Math.max(0, ctx.window - ctx.tokens))} left`

  return (
    <Box key="card" flexDirection="row" gap={2} borderStyle="round" borderColor={ROLE_COLORS[role]} paddingX={1}>
      {art}
      <Box flexDirection="column" flexShrink={1}>
        {meter('5h', 'g5', five?.percentUsed, m5, reset(five))}
        {meter('7d', 'g7', seven?.percentUsed, m7, reset(seven))}
        {meter('Context', 'gc', ctx.percent, undefined, ctxDetail)}
        <Box flexDirection="row" gap={1}>
          {label('Model')}
          <Text wrap="truncate-end">
            <Text bold>{clip(model, textCols)}</Text>
            <Text dimColor>{clip(effortText, textCols - [...model].length)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Tokens')}
          <Text wrap="truncate-end">
            <Text bold>{fmtTokens(tok.input)}</Text> input · <Text bold>{fmtTokens(tok.output)}</Text> output
            <Text dimColor>{clip(` · ${fmtTokens(tok.input + tok.output)} total${cachedText}`, textCols - 30)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Cost')}
          <Text wrap="truncate-end">
            <Text bold>{cost}</Text>
            <Text dimColor>{costRate}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Session')}
          <Text dimColor wrap="truncate-end">
            {clip(session, textCols)}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Path')}
          <Text wrap="truncate-end">
            <Text bold>{tail(path, textCols)}</Text>
            <Text color="success">{clip(pushText, textCols - [...path].length)}</Text>
          </Text>
        </Box>
      </Box>
      {hasBgColumn ? (
        <Box flexDirection="column" width={BG_COLS} flexShrink={0}>
          <Text bold>
            Background <Text dimColor>{bg.length}</Text>
          </Text>
          {bgShown.map((t, i) => {
            const dur = fmtDur(at - t.since)
            return (
              <Box key={t.id} flexDirection="row" gap={1}>
                {taskMark(t.kind, i)}
                <Text wrap="truncate-end">
                  {clip(t.label, BG_COLS - 4 - dur.length - 1)}
                  <Text dimColor> {dur}</Text>
                </Text>
              </Box>
            )
          })}
          {bg.length > bgShown.length ? <Text dimColor>+{bg.length - bgShown.length} more</Text> : undefined}
        </Box>
      ) : undefined}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'Show or hide the Clawd HUD above the prompt' })
    // Earlier versions opened a side pane; the HUD now lives above the prompt.
    void $.ui.close({ id: 'clawd-hud' })
    act = await read($, activity)
    if (!act.since) await setActivity($, 'idle')
    isAlarm = isHot((await $.session.usage()).rateLimits)
    // A reload drops the hooks that would end the calls listed before it; background tasks outlive it.
    await update($, running, () => [])
    taskCount = (await read($, tasks)).length
    await refresh($)
    for (const timer of timers) timer.cancel()
    timers = [
      $.clock.every(200, () => animate($)),
      $.clock.every(30_000, () => void refresh($)),
      // Tick the caption's and the tasks' seconds only while something runs.
      $.clock.every(1_000, () => void ((callsRunning || taskCount) && refresh($))),
    ]

    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    const hidden = await update($, isHidden, h => !h)

    return { text: hidden ? 'Clawd HUD hidden. /hud shows it again.' : 'Clawd HUD shown above the prompt.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command) await setActivity($, 'thinker')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    await update($, counts, c => ({
      edits: c.edits + (EDIT_TOOLS.test(e.tool) ? 1 : 0),
      commands: c.commands + (e.tool === 'Bash' ? 1 : 0),
      tools: c.tools + 1,
    }))
    // A subagent's own calls keep the role of the Agent call that spawned it.
    if (!(e.agentId && agentsRunning > 0)) await setActivity($, classify(e as unknown as Record<string, unknown>))
    const call = e.agentId ? undefined : { id: e.tool_use_id, tool: e.tool, since: await $.clock.now() }
    if (call) {
      callsRunning += 1
      await update($, running, r => [...r, call])
    }
    if (e.tool === 'Agent') agentsRunning += 1
    try {
      return await next(e)
    } finally {
      if (e.tool === 'Agent') agentsRunning -= 1
      if (call) {
        callsRunning -= 1
        await update($, running, r => r.filter(c => c.id !== call.id))
      }
    }
  }).catch(($, e, next) => next(e)) // the HUD never blocks a tool

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError && r.result?.gitOperation?.push) await celebrate($, r.result)
    const id = r.isError ? undefined : r.result?.backgroundTaskId
    if (id) await addTask($, { id, kind: 'shell', label: e.description || e.command })

    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const r = await next(e)
    // The record's union (its own, a plugin-raised call's, a teammate's) does not narrow on `status`: read the two fields.
    const out = (r.isError ? undefined : r.result) as { status?: string; agentId?: string } | undefined
    if (out?.status === 'async_launched' && out.agentId) await addTask($, { id: out.agentId, kind: 'subagent', label: e.description })

    return r
  }).catch(($, e, next) => next(e))

  // Each turn's end lists the background work in flight: that list is the record, ended tasks leave it.
  on('classic.Stop', async ($, e, next) => {
    const list = e.background_tasks
    if (list) {
      const at = await $.clock.now()
      await setTasks($, old =>
        list.map(t => ({
          id: t.id,
          kind: t.type,
          label: t.description || t.command || t.name || t.type,
          since: old.find(o => o.id === t.id)?.since ?? at,
        })),
      )
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
      }))
      await update($, cached, c => c + u.cache_read_input_tokens)
    }
    if (!e.agentId) await setActivity($, 'idle')

    return next(e)
  })

  // Effort has no session getter: each main-loop request carries the one in force.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await update($, effort, () => e.effort ?? null)

    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    isAlarm = isHot(e.rateLimits)
    const seen = await read($, warned)
    const fresh = e.rateLimits.filter(r => r.percentUsed >= 90 && !seen.includes(`${r.kind}@${r.resetsAt}`))
    for (const r of fresh) {
      const when = r.resetsAt ? ` · resets in ${fmtDur(Date.parse(r.resetsAt) - clockNow)}` : ''
      $.ui.toast(`⚠ ${windowName(r.kind)} usage at ${r.percentUsed}%${when}`)
    }
    if (fresh.length) await update($, warned, w => [...w, ...fresh.map(r => `${r.kind}@${r.resetsAt}`)])
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      bandId = undefined
      return next(e)
    }
    bandId = e.requestId
    // 8 text rows plus the round border.
    isBandWide = e.props.bodyColumns >= 90 && e.props.maxRows >= BIG.rows + 4

    return draw($, e, isBandWide, e.props.bodyColumns)
  })
}
