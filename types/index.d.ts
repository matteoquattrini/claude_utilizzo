export type Phase = {
  id: string
  tool: string
  hint: string
  startedAt: number
  /** null while the call is running */
  ms: number | null
}

export type TurnRow = {
  at: number
  ms: number
  tools: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  model: string
  usd: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  window: number
  tokens?: number
  percent?: number
  limits: Limit[]
  usd?: number
}

export type DayTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  turns: number
}

declare module 'claude-code' {
  interface PluginState {
    'utilizzo': {
      timeline: Phase[]
      turns: TurnRow[]
      snap: Snapshot | null
      /** keyed by local date, YYYY-MM-DD */
      days: Record<string, DayTotals>
      lastUsd: number
      alerted: number
      isBandHidden: boolean
    }
  }
}
