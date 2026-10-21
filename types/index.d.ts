export type Role =
  | 'engineer'
  | 'auditor'
  | 'detective'
  | 'operator'
  | 'explorer'
  | 'director'
  | 'whipper'
  | 'thinker'
  | 'shipper'
  | 'waiting'
  | 'compactor'
  | 'startled'
  | 'idle'
  | 'sleep'

export type Activity = { role: Role; since: number }
export type Tokens = { input: number; output: number }
export type Counts = { edits: number; commands: number; tools: number }
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number
export type Call = { id: string; tool: string; since: number }
export type Push = { repo: string; branch: string; at: number }
export type Task = { id: string; kind: string; label: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    'clawd-hud': {
      now: number
      activity: Activity
      tokens: Tokens
      cached: number
      running: Call[]
      push: Push | null
      tasks: Task[]
      counts: Counts
      effort: Effort | null
      warned: string[]
      isHidden: boolean
    }
  }
}

