const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
export const FIVE_HOURS = 5 * HOUR
export const WEEK = 7 * DAY
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const pad = (n: number) => String(n).padStart(2, '0')
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function fmtDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  return d ? `${d}d ${h}h` : h ? `${h}h${pad(m)}m` : `${m}m`
}

export function fmtWhen(at: number, now: number): string {
  const a = new Date(at)
  const hm = `${pad(a.getHours())}:${pad(a.getMinutes())}`
  const days = Math.round((startOfDay(a) - startOfDay(new Date(now))) / DAY)
  return days === 0 ? `hoy ${hm}` : days === 1 ? `mañana ${hm}` : `${DAYS[a.getDay()]} ${a.getDate()} ${hm}`
}

export function fmtTokens(n: number): string {
  if (n < 1e3) return `${n}`
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

export const tone = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

// shortcut: average rate since the window opened (resetsAt - span), not a sliding recent rate; keep samples if it reads too smooth.
export function windowInfo(pct: number, resetsAt: number, now: number, span: number) {
  const elapsed = Math.min(span, Math.max(0, now - (resetsAt - span)))
  const left = Math.max(0, resetsAt - now)
  const perMs = pct > 0 && elapsed >= 10 * MINUTE ? pct / elapsed : undefined
  const eta = perMs && pct < 100 ? now + (100 - pct) / perMs : undefined
  return {
    // Where usage would sit now if spread evenly to the reset: the gauge's marker.
    elapsedPct: (elapsed / span) * 100,
    perHour: perMs === undefined ? undefined : perMs * HOUR,
    eta: eta !== undefined && eta < resetsAt ? eta : undefined,
    perDayLeft: left >= HOUR ? ((100 - pct) / left) * DAY : undefined,
  }
}
