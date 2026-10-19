export type Role =
  | 'engineer'
  | 'auditor'
  | 'detective'
  | 'operator'
  | 'explorer'
  | 'director'
  | 'thinker'
  | 'idle'
  | 'sleep'

export type Activity = { role: Role; since: number }
export type Tokens = { input: number; output: number }
export type Counts = { edits: number; commands: number; tools: number }

declare module 'claude-code' {
  interface PluginState {
    'clawd-hud': {
      now: number
      activity: Activity
      tokens: Tokens
      counts: Counts
      warned: string[]
      isHidden: boolean
    }
  }
}

