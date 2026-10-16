import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayTotals, Limit, Phase, Snapshot, TurnRow } from '../types'

const PANE = 'utilizzo'
const KEY = 'days'

const timeline = atom({ plugin: 'utilizzo', key: 'timeline' } as const, [])
const turns = atom({ plugin: 'utilizzo', key: 'turns' } as const, [])
const snap = atom({ plugin: 'utilizzo', key: 'snap' } as const, null)
const days = atom({ plugin: 'utilizzo', key: 'days' } as const, {})
const lastUsd = atom({ plugin: 'utilizzo', key: 'lastUsd' } as const, 0)
const alerted = atom({ plugin: 'utilizzo', key: 'alerted' } as const, 0)
const isBandHidden = atom({ plugin: 'utilizzo', key: 'isBandHidden' } as const, false)

const THRESHOLDS = [70, 85, 95]
const LABEL = 10
const SEP = '  │  '
const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7g',
  spend_limit: 'spesa',
}

const pad = (n: number) => String(n).padStart(2, '0')

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${pad(Math.round((ms % 60_000) / 1000))}s`
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 10 ? 2 : 1)}`
}

function bar(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

type Cell = { ch: string; color: string }

const STOPS: [number, number, number][] = [
  [34, 197, 94], // green
  [234, 179, 8], // amber
  [239, 68, 68], // red
]

/** Colour at a position 0..100 along a smooth green → amber → red ramp, as hex. */
function gradient(percent: number): string {
  const t = Math.max(0, Math.min(1, percent / 100)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(t))
  const f = t - i
  const [a, b] = [STOPS[i]!, STOPS[i + 1]!]
  const hex = (k: number) =>
    Math.round(a[k]! + (b[k]! - a[k]!) * f)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(0)}${hex(1)}${hex(2)}`
}

/** A bar whose filled cells fade smoothly from green to red along its length; the unfilled cells stay dim. */
function barCells(percent: number, width: number): Cell[] {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return Array.from({ length: width }, (_, i) =>
    i < filled
      ? { ch: '▰', color: gradient(((i + 0.5) / width) * 100) }
      : { ch: '▱', color: 'inactive' },
  )
}

function levelColor(percent: number): 'success' | 'warning' | 'error' {
  return percent >= 85 ? 'error' : percent >= 65 ? 'warning' : 'success'
}

function untilReset(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (Number.isNaN(ms) || ms <= 0) return 'a breve'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}min`
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h${pad(mins % 60)}`
  return `${Math.round(mins / 1440)}g`
}

function kindOf(tool: string): 'read' | 'edit' | 'run' | 'other' {
  if (/^(Read|Glob|Grep|WebFetch|WebSearch|ToolSearch)$/.test(tool)) return 'read'
  if (/^(Edit|Write|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Bash|PowerShell|Monitor)$/.test(tool)) return 'run'
  return 'other'
}

const KIND_COLOR = { read: 'suggestion', edit: 'success', run: 'warning', other: 'inactive' } as const

function hintOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  const raw = o.file_path ?? o.command ?? o.pattern ?? o.path ?? o.url ?? o.query ?? o.description
  if (typeof raw !== 'string') return ''
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > 48 ? `${one.slice(0, 47)}…` : one
}

async function takeSnapshot($: EngineInterface): Promise<Snapshot> {
  const u = await $.session.usage()
  const limits: Limit[] = u.rateLimits.map((r) => ({
    kind: r.kind,
    percentUsed: r.percentUsed,
    resetsAt: r.resetsAt,
  }))
  return {
    window: u.context.window,
    tokens: u.context.tokens,
    percent: u.context.percent,
    limits,
    usd: u.cost?.usd,
  }
}

let isCompacting = false

async function compactNow($: EngineInterface): Promise<void> {
  if (isCompacting) return
  isCompacting = true
  $.ui.toast('Compattazione del contesto in corso…')
  try {
    const r = await $.session.compact()
    if ('skip' in r && r.skip !== undefined) {
      $.ui.toast(`Compattazione non eseguita: ${r.skip}`)
    } else {
      const before = r.tokensBefore
      const after = r.tokensAfter
      $.ui.toast(
        before !== undefined && after !== undefined
          ? `Contesto compattato: ${fmtTokens(before)} → ${fmtTokens(after)} token`
          : 'Contesto compattato',
      )
    }
  } catch {
    $.ui.toast('Compattazione fallita')
  } finally {
    isCompacting = false
    const fresh = await takeSnapshot($)
    await update($, snap, () => fresh)
  }
}

export const register: Register = (on) => {
  let turnStartedAt = 0
  let turnTools = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'utilizzo',
      description: 'Apri il pannello con timeline, contesto, token e limiti dell’account',
    })
    const stored = (await $.store.get(KEY)) as Record<string, DayTotals> | undefined
    await update($, days, () => stored ?? {})
    const s = await takeSnapshot($)
    await update($, snap, () => s)
    await update($, lastUsd, () => s.usd ?? 0)

    return next(e)
  })

  on('command.run', { command: 'utilizzo' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Utilizzo' })

    return { text: 'Pannello Utilizzo aperto.' }
  })

  on('turn.start', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    turnTools = 0

    return next(e)
  })

  // 9. Timeline: one row per tool call, with its duration.
  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    turnTools += 1
    const phase: Phase = {
      id: e.tool_use_id,
      tool: String(e.tool),
      hint: hintOf((e as unknown as { input?: unknown }).input),
      startedAt,
      ms: null,
    }
    await update($, timeline, (list) => [...list, phase].slice(-120))
    const ran = await next(e)
    const ms = (await $.clock.now()) - startedAt
    await update($, timeline, (list) => list.map((p) => (p.id === phase.id ? { ...p, ms } : p)))

    return ran
  })

  // 11. Context fill and 5h/7d windows, kept fresh as the engine measures them.
  on('session.measure', async ($, e, next) => {
    const s: Snapshot = {
      window: e.context.window,
      tokens: e.context.tokens,
      percent: e.context.percent,
      limits: e.rateLimits.map((r) => ({
        kind: r.kind,
        percentUsed: r.percentUsed,
        resetsAt: r.resetsAt,
      })),
      usd: e.cost?.usd,
    }
    await update($, snap, () => s)

    const pct = s.percent ?? 0
    const done = await read($, alerted)
    const crossed = THRESHOLDS.filter((t) => pct >= t && t > done)
    if (crossed.length > 0) {
      const top = crossed[crossed.length - 1]!
      await update($, alerted, () => top)
      $.ui.toast(
        top >= 95
          ? `Contesto al ${pct}%: compatta ora (/compact) o apri una nuova sessione`
          : `Contesto al ${pct}%: valuta di compattare presto`,
      )
    } else if (pct < 60 && done > 0) {
      await update($, alerted, () => 0)
    }

    return next(e)
  })

  // Per-turn and per-day token and cost accounting, kept across sessions.
  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const u = e.usage
    const current = await $.session.usage()
    const usdNow = current.cost?.usd ?? 0
    const before = await read($, lastUsd)
    const usd = Math.max(0, usdNow - before)
    await update($, lastUsd, () => usdNow)

    if (u) {
      const key = dayKey(now)
      await update($, days, (all) => {
        const d = all[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0 }
        const merged: Record<string, DayTotals> = {
          ...all,
          [key]: {
            input: d.input + u.input_tokens,
            output: d.output + u.output_tokens,
            cacheRead: d.cacheRead + u.cache_read_input_tokens,
            cacheWrite: d.cacheWrite + u.cache_creation_input_tokens,
            usd: d.usd + usd,
            turns: d.turns + 1,
          },
        }
        const keep = Object.keys(merged).sort().slice(-60)
        return Object.fromEntries(keep.map((k) => [k, merged[k]!]))
      })
      await $.store.set(KEY, await read($, days))

      if (!e.agentId) {
        const row: TurnRow = {
          at: now,
          ms: Math.max(0, now - turnStartedAt),
          tools: turnTools,
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
          model: u.model,
          usd,
        }
        await update($, turns, (list) => [...list, row].slice(-30))
      }
    }
    const fresh = await takeSnapshot($)
    await update($, snap, () => fresh)

    return next(e)
  })

  // Band above the prompt: context, windows, session cost.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null || (await read($, isBandHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const pct = s.percent ?? 0
    const rows = await read($, turns)
    const list = await read($, timeline)
    const all = await read($, days)
    const now = await $.clock.now()

    const sum = rows.reduce(
      (a, r) => ({
        input: a.input + r.input,
        output: a.output + r.output,
        cacheRead: a.cacheRead + r.cacheRead,
        cacheWrite: a.cacheWrite + r.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    )
    const promptTotal = sum.input + sum.cacheRead + sum.cacheWrite
    const hit = promptTotal > 0 ? Math.round((sum.cacheRead / promptTotal) * 100) : null
    const lastTurn = rows[rows.length - 1]
    const today = all[dayKey(now)]
    const running = list.filter((p) => p.ms === null).pop()
    const lastDone = list.filter((p) => p.ms !== null).pop()
    const slowest = list.reduce<Phase | null>((m, p) => ((p.ms ?? 0) > (m?.ms ?? 0) ? p : m), null)

    // A labelled figure: dim label, bold value, dim separator after it.
    const stat = (label: string, value: string, color?: string) => (
      <Box>
        <Text dimColor>{label} </Text>
        <Text bold color={color}>
          {value}
        </Text>
        <Text dimColor>{SEP}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          <Text dimColor>{'contesto'.padEnd(LABEL)}</Text>
          {barCells(pct, 20).map((c) => (
            <Text color={c.color}>{c.ch}</Text>
          ))}
          <Text bold color={gradient(pct)}>
            {' '}
            {s.percent === undefined ? '–' : `${pct}%`}
          </Text>
          {s.tokens !== undefined && (
            <Box>
              <Text bold>{` ${fmtTokens(s.tokens)}`}</Text>
              <Text dimColor>/</Text>
              <Text bold>{fmtTokens(s.window)}</Text>
              <Text dimColor>{' token  '}</Text>
            </Box>
          )}
          <Button key="compact" label="Compatta" onPress={() => compactNow($)} />
          <Button key="open" label="Dettagli" onPress={() => $.ui.open({ id: PANE, title: 'Utilizzo' })} />
          <Button key="hide" label="Nascondi" onPress={() => update($, isBandHidden, () => true)} />
        </Box>

        {s.limits.length > 0 && (
          <Box flexWrap="wrap">
            <Text dimColor>{'limiti'.padEnd(LABEL)}</Text>
            {s.limits.map((l) => (
              <Box>
                <Text bold>{LIMIT_NAMES[l.kind] ?? l.kind} </Text>
                {barCells(l.percentUsed, 8).map((c) => (
                  <Text color={c.color}>{c.ch}</Text>
                ))}
                <Text bold color={gradient(l.percentUsed)}>{` ${l.percentUsed}%`}</Text>
                {l.resetsAt ? (
                  <Box>
                    <Text dimColor>{' reset '}</Text>
                    <Text bold>{untilReset(l.resetsAt, now)}</Text>
                  </Box>
                ) : null}
                <Text>{'   '}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexWrap="wrap">
          <Text dimColor>{'sessione'.padEnd(LABEL)}</Text>
          {stat('costo', s.usd !== undefined ? fmtUsd(s.usd) : '–', 'text')}
          {stat('turni', String(rows.length))}
          {stat('↓ in', fmtTokens(sum.input + sum.cacheRead + sum.cacheWrite))}
          {stat('↑ out', fmtTokens(sum.output))}
          {hit !== null && stat('cache', `${hit}%`, gradient(100 - hit))}
          {today && stat('oggi', fmtUsd(today.usd))}
        </Box>

        <Box flexWrap="wrap">
          <Text dimColor>{'attività'.padEnd(LABEL)}</Text>
          {running ? (
            <Box>
              <Text bold color="warning">
                ▶ {running.tool}
              </Text>
              <Text dimColor>{running.hint ? ` ${running.hint}` : ''}</Text>
              <Text dimColor>{SEP}</Text>
            </Box>
          ) : (
            <Box>
              <Text dimColor>● ferma{SEP}</Text>
            </Box>
          )}
          {lastTurn
            ? stat('ultimo turno', `${fmtMs(lastTurn.ms)} · ${lastTurn.tools} tool · ${fmtUsd(lastTurn.usd)}`)
            : stat('ultimo turno', '–')}
          {!running && lastDone && stat('ultimo tool', `${lastDone.tool} ${fmtMs(lastDone.ms ?? 0)}`)}
          {slowest && (slowest.ms ?? 0) > 0 && stat('più lento', `${slowest.tool} ${fmtMs(slowest.ms ?? 0)}`)}
        </Box>
      </Box>
    )
  })

  // The pane: overview, account windows, turns, timeline, history.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snap)
    const list = await read($, timeline)
    const rows = await read($, turns)
    const all = await read($, days)
    const now = await $.clock.now()
    const cols = Math.max(30, e.props.bodyColumns ?? 60)
    const barW = Math.min(30, Math.max(10, cols - 34))
    const room = Math.max(4, (e.viewport?.rows ?? 30) - 4)

    const sessionTotals = rows.reduce(
      (a, r) => ({
        input: a.input + r.input,
        output: a.output + r.output,
        cacheRead: a.cacheRead + r.cacheRead,
        cacheWrite: a.cacheWrite + r.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    )
    const promptTotal = sessionTotals.input + sessionTotals.cacheRead + sessionTotals.cacheWrite
    const hitRate = promptTotal > 0 ? Math.round((sessionTotals.cacheRead / promptTotal) * 100) : null

    const dayKeys = Object.keys(all).sort().slice(-7)
    const maxDayUsd = Math.max(0.0001, ...dayKeys.map((k) => all[k]!.usd))
    const week = dayKeys.reduce((a, k) => a + all[k]!.usd, 0)

    const recent = list.slice(-Math.min(12, room))
    const maxMs = Math.max(1, ...recent.map((p) => p.ms ?? 0))
    const byTool: Record<string, number> = {}
    for (const p of list) byTool[p.tool] = (byTool[p.tool] ?? 0) + (p.ms ?? 0)
    const topTools = Object.entries(byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    return (
      <Box flexDirection="column">
        <Text bold>Contesto</Text>
        {s === null || s.percent === undefined ? (
          <Text dimColor>In attesa della prima risposta…</Text>
        ) : (
          <Text>
            {barCells(s.percent, barW).map((c) => (
              <Text color={c.color}>{c.ch}</Text>
            ))}{' '}
            <Text bold color={gradient(s.percent)}>
              {s.percent}%
            </Text>{' '}
            <Text dimColor>
              ({fmtTokens(s.tokens ?? 0)} / {fmtTokens(s.window)})
            </Text>
          </Text>
        )}

        <Text bold>{'\n'}Limiti dell’account</Text>
        {s === null || s.limits.length === 0 ? (
          <Text dimColor>Nessun dato (disponibile solo con abbonamento, dopo la prima risposta).</Text>
        ) : (
          s.limits.map((l) => (
            <Text>
              {(LIMIT_NAMES[l.kind] ?? l.kind).padEnd(6)}
              {barCells(l.percentUsed, barW).map((c) => (
                <Text color={c.color}>{c.ch}</Text>
              ))}{' '}
              <Text bold color={gradient(l.percentUsed)}>
                {l.percentUsed}%
              </Text>{' '}
              <Text dimColor>reset tra {untilReset(l.resetsAt, now)}</Text>
            </Text>
          ))
        )}

        <Text bold>{'\n'}Questa sessione</Text>
        <Text>
          {s?.usd !== undefined ? fmtUsd(s.usd) : '–'} · {rows.length} turni · in {fmtTokens(sessionTotals.input)} · out{' '}
          {fmtTokens(sessionTotals.output)}
          {hitRate !== null ? ` · cache ${hitRate}%` : ''}
        </Text>
        {rows.slice(-5).map((r) => (
          <Text dimColor>
            {fmtMs(r.ms).padStart(7)} · {String(r.tools).padStart(2)} tool · {fmtTokens(r.input + r.cacheRead + r.cacheWrite)} →{' '}
            {fmtTokens(r.output)} · {fmtUsd(r.usd)}
          </Text>
        ))}

        <Text bold>{'\n'}Timeline</Text>
        {recent.length === 0 && <Text dimColor>Nessuna chiamata ai tool per ora.</Text>}
        {recent.map((p) => (
          <Text>
            <Text color={KIND_COLOR[kindOf(p.tool)]}>{(p.ms === null ? '▶' : '█'.repeat(Math.max(1, Math.round(((p.ms ?? 0) / maxMs) * 8)))).padEnd(8)}</Text>{' '}
            {p.tool} <Text dimColor>{p.ms === null ? 'in corso' : fmtMs(p.ms)} {p.hint}</Text>
          </Text>
        ))}
        {topTools.length > 0 && (
          <Text dimColor>
            Più lenti: {topTools.map(([t, ms]) => `${t} ${fmtMs(ms)}`).join(' · ')}
          </Text>
        )}

        <Text bold>{'\n'}Ultimi 7 giorni (costo, sessioni con questo mod)</Text>
        {dayKeys.length === 0 && <Text dimColor>Ancora nessun dato.</Text>}
        {dayKeys.map((k) => {
          const d = all[k]!
          return (
            <Text>
              {k.slice(5)} <Text color="suggestion">{bar((d.usd / maxDayUsd) * 100, 14)}</Text> {fmtUsd(d.usd).padStart(6)}{' '}
              <Text dimColor>
                {fmtTokens(d.input + d.cacheRead + d.cacheWrite)} in · {fmtTokens(d.output)} out · {d.turns} turni
              </Text>
            </Text>
          )
        })}
        {dayKeys.length > 0 && <Text dimColor>Totale 7 giorni: {fmtUsd(week)}</Text>}

        <Box>
          <Button key="compact" label="Compatta contesto" onPress={() => compactNow($)} />
          <Button key="refresh" label="Aggiorna" onPress={async () => {
              const fresh = await takeSnapshot($)
              await update($, snap, () => fresh)
            }} />
          <Button key="show-band" label="Mostra banda" onPress={() => update($, isBandHidden, () => false)} />
        </Box>
      </Box>
    )
  })
}
