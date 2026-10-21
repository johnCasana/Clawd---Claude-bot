import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, SessionRateLimit, Timer } from 'claude-code'

import type { Activity, Role } from '../types'
import { FIVE_HOURS, WEEK, elapsedPct, fmtDur, fmtEffort, fmtTokens, fmtWhen, tone } from './format'
import { BIG, MINI, bigFrame, gaugeCells, miniFrame } from './sprites'

const SLEEP_AFTER = 60_000
const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/
const REVIEW = /review|audit|revis|security/i

const now = atom({ plugin: 'clawd-hud', key: 'now' } as const, 0)
const activity = atom({ plugin: 'clawd-hud', key: 'activity' } as const, { role: 'idle', since: 0 })
const tokens = atom({ plugin: 'clawd-hud', key: 'tokens' } as const, { input: 0, output: 0 })
const counts = atom({ plugin: 'clawd-hud', key: 'counts' } as const, { edits: 0, commands: 0, tools: 0 })
const effort = atom({ plugin: 'clawd-hud', key: 'effort' } as const, null)
const warned = atom({ plugin: 'clawd-hud', key: 'warned' } as const, [])
const isHidden = atom({ plugin: 'clawd-hud', key: 'isHidden' } as const, false)

const windowName = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind)
const isHot = (limits: readonly SessionRateLimit[]) => limits.some(r => r.percentUsed >= 90)
// Cut to n columns ourselves: a row whose text overflows next to a Raster wraps to two rows, truncated or not.
const clip = (text: string, n: number) => ([...text].length <= n ? text : [...text].slice(0, Math.max(0, n - 1)).join('') + '…')
const shownRole = (a: Activity, at: number): Role => (a.role === 'idle' && at - a.since > SLEEP_AFTER ? 'sleep' : a.role)

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
let timers: Timer[] = []

async function setActivity($: EngineInterface, role: Role) {
  act = { role, since: await $.clock.now() }
  await update($, activity, () => act)
}

async function refresh($: EngineInterface) {
  clockNow = await $.clock.now()
  await update($, now, () => clockNow)
}

function animate($: EngineInterface) {
  frame += 1
  if (!bandId) return
  const role = shownRole(act, clockNow)
  const cells = isBandWide ? bigFrame(role, frame, isAlarm) : miniFrame(role, frame, isAlarm)
  void $.ui.blit({ requestId: bandId, key: isBandWide ? 'clawd' : 'clawd-mini', cells })
}

async function draw($: EngineInterface, e: RenderInput<'AbovePrompt'>, isWide: boolean, width: number) {
  const { Box, Text } = $.ui.resolve(e)
  const [at, a, tok, cnt, eff, model, usage] = await Promise.all([
    read($, now),
    read($, activity),
    read($, tokens),
    read($, counts),
    read($, effort),
    $.session.model(),
    $.session.usage(),
  ])
  const effortText = eff === null ? '' : ` · esfuerzo ${fmtEffort(eff)}`
  const role = shownRole(a, at)
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
  const session = `${fmtDur(at - usage.startedAt)} · ${cnt.edits} ediciones · ${cnt.commands} comandos · ${cnt.tools} tools`
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
      <Raster key="clawd" columns={BIG.columns} rows={BIG.rows} cells={bigFrame(role, frame, isAlarm)} />
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
            {chip('Contexto', 'bc', ctx.percent)}
          </Box>
          <Text wrap="truncate-end">
            <Text bold>{model}</Text>
            <Text dimColor>{effortText}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {fmtTokens(tok.input)} entrada · {fmtTokens(tok.output)} salida · {cost}
            {costRate} · {session}
          </Text>
        </Box>
      </Box>
    )
  }

  // Beside the mascot, inside the round border and its padding, after the label column.
  const textCols = width - 4 - BIG.columns - 2 - 9 - 1
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
      ? `${Math.max(0, Math.round(100 - r.percentUsed))}% libre · ↻ ${fmtWhen(Date.parse(r.resetsAt), at)} (${fmtDur(Date.parse(r.resetsAt) - at)})`
      : ''
  const ctxDetail =
    ctx.tokens === undefined
      ? `ventana de ${fmtTokens(ctx.window)}`
      : `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)} · ${fmtTokens(Math.max(0, ctx.window - ctx.tokens))} libres`

  return (
    <Box flexDirection="row" gap={2} borderStyle="round" borderColor="claude" paddingX={1}>
      {art}
      <Box flexDirection="column" flexShrink={1}>
        {meter('5h', 'g5', five?.percentUsed, m5, reset(five))}
        {meter('7d', 'g7', seven?.percentUsed, m7, reset(seven))}
        {meter('Contexto', 'gc', ctx.percent, undefined, ctxDetail)}
        <Box flexDirection="row" gap={1}>
          {label('Modelo')}
          <Text wrap="truncate-end">
            <Text bold>{clip(model, textCols)}</Text>
            <Text dimColor>{clip(effortText, textCols - [...model].length)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Tokens')}
          <Text wrap="truncate-end">
            <Text bold>{fmtTokens(tok.input)}</Text> entrada · <Text bold>{fmtTokens(tok.output)}</Text> salida
            <Text dimColor>{clip(` · ${fmtTokens(tok.input + tok.output)} en total`, textCols - 30)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Costo')}
          <Text wrap="truncate-end">
            <Text bold>{cost}</Text>
            <Text dimColor>{costRate}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {label('Sesión')}
          <Text dimColor wrap="truncate-end">
            {clip(session, textCols)}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'Muestra u oculta el Clawd HUD sobre el prompt' })
    // Earlier versions opened a side pane; the HUD now lives above the prompt.
    void $.ui.close({ id: 'clawd-hud' })
    act = await read($, activity)
    if (!act.since) await setActivity($, 'idle')
    isAlarm = isHot((await $.session.usage()).rateLimits)
    await refresh($)
    for (const timer of timers) timer.cancel()
    timers = [$.clock.every(200, () => animate($)), $.clock.every(30_000, () => void refresh($))]

    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    const hidden = await update($, isHidden, h => !h)

    return { text: hidden ? 'Clawd HUD oculto. /hud lo vuelve a mostrar.' : 'Clawd HUD visible sobre el prompt.' }
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
    if (e.tool !== 'Agent') return next(e)

    agentsRunning += 1
    try {
      return await next(e)
    } finally {
      agentsRunning -= 1
    }
  }).catch(($, e, next) => next(e)) // the HUD never blocks a tool

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
      }))
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
      const when = r.resetsAt ? ` · recarga en ${fmtDur(Date.parse(r.resetsAt) - clockNow)}` : ''
      $.ui.toast(`⚠ Uso ${windowName(r.kind)} al ${r.percentUsed}%${when}`)
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
    // 7 text rows plus the round border.
    isBandWide = e.props.bodyColumns >= 90 && e.props.maxRows >= BIG.rows + 3

    return draw($, e, isBandWide, e.props.bodyColumns)
  })
}
