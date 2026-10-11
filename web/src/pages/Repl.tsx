import { useEffect, useRef, useState } from 'react'
import { api, stream } from '../api/client'
import type { ReplEvent } from '../api/types'
import { Button, Card, Check, Field, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { useApp } from '../state/app'

const QUICK = ['help', 'show', 'show debug', 'trace', 'notes', 'metrics', 'instrument', 'pretty', 'json', 'unset input', 'types', 'exit']

export default function Repl() {
  const { ws, readOnly } = useApp()
  const toast = useToast()
  const [session, setSession] = useState<string | null>(null)
  const [events, setEvents] = useState<ReplEvent[]>([])
  const [line, setLine] = useState('')
  const [hist, setHist] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const [loadWs, setLoadWs] = useState(true)
  const [extra, setExtra] = useState('')
  const out = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session) return
    return stream<ReplEvent>(`/api/repl/${session}/stream`, (e) => setEvents((x) => [...x, e].slice(-4000)))
  }, [session])

  useEffect(() => {
    out.current?.scrollTo(0, out.current.scrollHeight)
  }, [events])

  useEffect(() => () => {
    if (session) void api.replClose(session).catch(() => undefined)
  }, [session])

  const start = async () => {
    try {
      if (session) await api.replClose(session).catch(() => undefined)
      setEvents([])
      const s = await api.replStart({ workspace: loadWs ? ws : undefined, args: shellSplit(extra) })
      setSession(s.id)
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const send = async (text: string) => {
    if (!session) return
    try {
      await api.replInput(session, text)
      setHist((h) => [text, ...h.filter((x) => x !== text)].slice(0, 100))
      setHIdx(-1)
      setLine('')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  return (
    <div className="page">
      <Card
        title="Interactive Rego shell (opa run)"
        subtitle="Define rules, evaluate expressions and inspect traces exactly like the OPA REPL."
        actions={
          <>
            <Check label="load active workspace" checked={loadWs} onChange={setLoadWs} />
            <Button icon="play" variant="primary" onClick={() => void start()} disabled={readOnly && false}>{session ? 'Restart' : 'Start session'}</Button>
            {session && <Button icon="stop" variant="danger" onClick={async () => { await api.replClose(session).catch(() => undefined); setSession(null) }}>Stop</Button>}
          </>
        }
      >
        <div className="stack">
          <Field label="Additional opa run flags" hint="e.g. --v0-compatible, --format=json, --set=...">
            <input className="mono" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
          <div className="terminal" ref={out} style={{ height: 'calc(100vh - 420px)', minHeight: 260 }}>
            {events.length === 0 && <span className="system">{session ? 'Waiting for output…' : 'Start a session to open the REPL.'}</span>}
            {events.map((e) => (
              <span key={e.seq} className={e.stream}>{e.text}</span>
            ))}
          </div>
          <div className="row nowrap">
            <span className="mono" style={{ color: 'var(--accent)' }}>&gt;</span>
            <input
              className="grow mono"
              value={line}
              disabled={!session}
              placeholder={session ? 'data.app.rbac.allow with input as {"user": "alice"}' : ''}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send(line)
                if (e.key === 'ArrowUp' && hist.length) {
                  const i = Math.min(hIdx + 1, hist.length - 1)
                  setHIdx(i)
                  setLine(hist[i])
                  e.preventDefault()
                }
                if (e.key === 'ArrowDown') {
                  const i = hIdx - 1
                  setHIdx(i)
                  setLine(i >= 0 ? hist[i] : '')
                  e.preventDefault()
                }
              }}
            />
            <Button variant="primary" disabled={!session} onClick={() => void send(line)}>Send</Button>
          </div>
          <div className="row">
            {QUICK.map((q) => (
              <Button key={q} size="sm" disabled={!session} onClick={() => void send(q)}>{q}</Button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
