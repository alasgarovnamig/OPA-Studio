import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stream } from '../api/client'
import type { LocalSettings, LocalState, LogLine } from '../api/types'
import { Editor } from '../components/Editor'
import { Alert, Badge, Button, Card, Check, CommandPreview, Field, KV, useToast } from '../components/ui'
import { hasFlag } from '../lib/features'
import { ago } from '../lib/format'
import { useApp } from '../state/app'

export default function LocalOpa() {
  const { workspaces, cli, readOnly, reprobe } = useApp()
  const toast = useToast()
  const [enabled, setEnabled] = useState(true)
  const [state, setState] = useState<LocalState | null>(null)
  const [settings, setSettings] = useState<LocalSettings | null>(null)
  const [preview, setPreview] = useState<string[]>([])
  const [previewError, setPreviewError] = useState<string | undefined>()
  const [logs, setLogs] = useState<LogLine[]>([])
  const [extra, setExtra] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const r = await api.localState()
    setEnabled(r.enabled)
    if (r.state) setState(r.state)
    if (r.settings && !settings) {
      setSettings(r.settings)
      setExtra((r.settings.extraArgs ?? []).join(' '))
    }
    setPreview(r.preview ?? [])
    setPreviewError(r.previewError)
  }, [settings])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => stream<LogLine>('/api/local-opa/logs/stream', (l) => setLogs((x) => [...x, l].slice(-2000))), [])
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  if (!enabled) {
    return <div className="page"><Alert kind="info" title="Local OPA is disabled">Start OPA Studio with OPA_STUDIO_LOCAL_OPA=true and an OPA binary to manage a local server.</Alert></div>
  }

  const act = async (a: 'start' | 'stop' | 'restart') => {
    try {
      const r = await api.localAction(a)
      setState(r.state)
      toast(`Local OPA: ${r.state.status}`, r.state.status === 'running' || a === 'stop' ? 'ok' : 'info')
      setTimeout(() => void reprobe(), 600)
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const saveSettings = async (restart: boolean) => {
    if (!settings) return
    try {
      const r = await api.localSettings({ ...settings, extraArgs: extra.split(/\s+/).filter(Boolean) })
      setPreview(r.preview)
      toast('Settings saved', 'ok')
      if (restart) await act('restart')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const kind = state?.status === 'running' ? 'ok' : state?.status === 'starting' ? 'info' : state?.status === 'stopped' ? undefined : 'err'
  return (
    <div className="page">
      <div className="grid cols-2">
        <Card
          title="Process"
          actions={
            <>
              <Button icon="play" variant="primary" disabled={readOnly || state?.status === 'running'} onClick={() => void act('start')}>Start</Button>
              <Button icon="refresh" disabled={readOnly} onClick={() => void act('restart')}>Restart</Button>
              <Button icon="stop" variant="danger" disabled={readOnly || state?.status === 'stopped'} onClick={() => void act('stop')}>Stop</Button>
            </>
          }
        >
          <KV
            items={[
              ['Status', <Badge kind={kind}>{state?.status ?? '…'}</Badge>],
              ['URL', <code>{state?.url}</code>],
              ['PID', state?.pid ?? '—'],
              ['Started', ago(state?.startedAt)],
              ['Restarts', state?.restarts ?? 0],
              ['Last exit', state?.exitCode !== undefined ? `code ${state.exitCode} (${ago(state.exitedAt)})` : '—'],
              ['Error', state?.error ?? '—'],
            ]}
          />
          {preview.length > 0 && <div style={{ marginTop: 12 }}><CommandPreview args={preview.slice(1)} /></div>}
          {previewError && <Alert kind="err">{previewError}</Alert>}
        </Card>
        {settings && (
          <Card title="Settings" actions={<><Button disabled={readOnly} onClick={() => void saveSettings(false)}>Save</Button><Button variant="primary" disabled={readOnly} onClick={() => void saveSettings(true)}>Save &amp; restart</Button></>}>
            <div className="stack">
              <div className="form-grid">
                <Field label="Listen address (--addr)"><input className="mono" value={settings.addr} onChange={(e) => setSettings({ ...settings, addr: e.target.value })} /></Field>
                <Field label="Load workspace">
                  <select value={settings.workspace} onChange={(e) => setSettings({ ...settings, workspace: e.target.value })}>
                    <option value="">(none — empty server)</option>
                    {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
                {hasFlag(cli, 'run', 'log-level') && (
                  <Field label="--log-level"><select value={settings.logLevel} onChange={(e) => setSettings({ ...settings, logLevel: e.target.value })}>{['', 'debug', 'info', 'warn', 'error'].map((l) => <option key={l} value={l}>{l || 'default'}</option>)}</select></Field>
                )}
              </div>
              <div className="row">
                <Check label="Start with Studio" checked={settings.autostart} onChange={(v) => setSettings({ ...settings, autostart: v })} />
                <Check label="Restart on failure" checked={settings.restartOnFailure} onChange={(v) => setSettings({ ...settings, restartOnFailure: v })} />
                {hasFlag(cli, 'run', 'watch') && <Check label="--watch (reload workspace changes)" checked={settings.watch} onChange={(v) => setSettings({ ...settings, watch: v })} />}
              </div>
              <Field label="Extra flags" hint="Any other `opa run` flag: --authentication=token --authorization=basic --set decision_logs.console=true --pprof --diagnostic-addr … ">
                <input className="mono" value={extra} onChange={(e) => setExtra(e.target.value)} />
              </Field>
              {hasFlag(cli, 'run', 'config-file') && (
                <Field label="Configuration file (--config-file, YAML)" hint="services, bundles, decision_logs, status, discovery, keys, distributed_tracing, server.encoding …">
                  <Editor value={settings.config} onChange={(v) => setSettings({ ...settings, config: v })} language="yaml" height={220} placeholder="decision_logs:\n  console: true" />
                </Field>
              )}
            </div>
          </Card>
        )}
      </div>
      <Card title="Logs" subtitle="stdout and stderr of the OPA process" actions={<Button size="sm" icon="trash" onClick={async () => { await api.clearLocalLogs(); setLogs([]) }}>Clear</Button>}>
        <div className="terminal" ref={logRef} style={{ height: 360 }}>
          {logs.map((l) => (
            <div key={l.seq} className={l.stream === 'stderr' ? 'stderr' : l.stream === 'studio' ? 'system' : ''}>{l.text}</div>
          ))}
          {!logs.length && <span className="system">No output yet.</span>}
        </div>
      </Card>
    </div>
  )
}
