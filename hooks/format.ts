const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
export const FIVE_HOURS = 5 * HOUR
export const WEEK = 7 * DAY
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function fmtDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  return d ? `${d}d ${h}h` : h ? `${h}h${pad(m)}m` : m ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
}

export function fmtWhen(at: number, now: number): string {
  const a = new Date(at)
  const hm = `${pad(a.getHours())}:${pad(a.getMinutes())}`
  const days = Math.round((startOfDay(a) - startOfDay(new Date(now))) / DAY)
  return days === 0 ? `today ${hm}` : days === 1 ? `tomorrow ${hm}` : `${DAYS[a.getDay()]} ${a.getDate()} ${hm}`
}

export function fmtTokens(n: number): string {
  if (n < 1e3) return `${n}`
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

export const tone = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

// Where usage would sit now if spread evenly to the reset: the gauge's marker.
export const elapsedPct = (resetsAt: number, now: number, span: number) =>
  (Math.min(span, Math.max(0, now - (resetsAt - span))) / span) * 100
