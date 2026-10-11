import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { CliResult, Command, Flag } from '../api/types'
import { Alert, Badge, Button, Card, Check, CliOutput, CommandPreview, Field, Pills, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { base64ToBytes, bytes, download } from '../lib/format'
import { useApp } from '../state/app'

type Values = Record<string, string | boolean>

function isList(f: Flag) {
  return /^(stringArray|strings|stringSlice|stringToString|uintSlice|intSlice)$/.test(f.type)
}

function FlagInput({ name, flag, value, onChange }: { name: string; flag: Flag; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  const enumMatch = flag.type.match(/^\{(.+)\}$/)
  if (flag.type === 'bool') {
    return <Check label={<span className="flag-name">--{name}</span>} checked={!!value} onChange={onChange} />
  }
  return (
    <div className="flag">
      <span className="flag-name">--{name} <span className="muted">{flag.type}</span></span>
      {enumMatch ? (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">(default{flag.default ? `: ${flag.default}` : ''})</option>
          {enumMatch[1].split(',').map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : isList(flag) ? (
        <textarea rows={2} value={String(value ?? '')} placeholder="one value per line" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="mono" value={String(value ?? '')} placeholder={flag.default ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

/**
 * The command builder renders a form for every command, subcommand and flag
 * of the bundled OPA binary straight from the measured manifest, so any CLI
 * operation of any OPA version can be executed from the UI.
 */
export default function Builder() {
  const { cli, ws } = useApp()
  const toast = useToast()
  const commands = useMemo(() => Object.entries(cli?.cli.commands ?? {}).filter(([n]) => n !== 'help' && n !== 'run').sort(([a], [b]) => a.localeCompare(b)), [cli])
  const [mode, setMode] = useState<'form' | 'raw'>('form')
  const [cmd, setCmd] = useState(commands[0]?.[0] ?? 'version')
  const [sub, setSub] = useState('')
  const [values, setValues] = useState<Values>({})
  const [positional, setPositional] = useState('')
  const [raw, setRaw] = useState('eval -d . --ignore input*.json data')
  const [useWs, setUseWs] = useState(true)
  const [collect, setCollect] = useState('')
  const [stdin, setStdin] = useState('')
  const [filter, setFilter] = useState('')
  const [res, setRes] = useState<CliResult | null>(null)
  const [busy, setBusy] = useState(false)

  const command: Command | undefined = cli?.cli.commands[cmd]
  const subs = Object.keys(command?.subcommands ?? {})
  const active: Command | undefined = sub ? command?.subcommands?.[sub] : command
  const flags = Object.entries(active?.flags ?? {}).filter(([n, f]) => n !== 'help' && !f.global).sort(([a], [b]) => a.localeCompare(b))
  const shown = flags.filter(([n, f]) => !filter || n.includes(filter) || f.description.toLowerCase().includes(filter.toLowerCase()))

  const args = useMemo(() => {
    if (mode === 'raw') return shellSplit(raw)
    const a = [cmd]
    if (sub) a.push(sub)
    for (const [n, f] of flags) {
      const v = values[n]
      if (v === undefined || v === '' || v === false) continue
      if (f.type === 'bool') a.push(`--${n}`)
      else if (isList(f)) String(v).split('\n').map((s) => s.trim()).filter(Boolean).forEach((x) => a.push(`--${n}`, x))
      else a.push(`--${n}`, String(v))
    }
    a.push(...shellSplit(positional))
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, raw, cmd, sub, values, positional, active])

  const run = async () => {
    setBusy(true)
    try {
      setRes(await api.cli({ args, workspace: useWs ? ws : undefined, stdin: stdin || undefined, collect: collect.split(',').map((s) => s.trim()).filter(Boolean) }))
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <CommandPreview args={args} />
      <div className="row">
        <Pills options={[{ id: 'form', label: 'Form' }, { id: 'raw', label: 'Raw command line' }]} value={mode} onChange={setMode} />
        <Check label="run inside a copy of the active workspace" checked={useWs} onChange={setUseWs} />
        <Button icon="play" variant="primary" className="right" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run'}</Button>
      </div>
      {mode === 'form' ? (
        <div className="split sidebar-left">
          <Card title="Commands" flush>
            <div className="list">
              {commands.map(([n, c]) => (
                <div key={n} className={`list-item ${n === cmd ? 'active' : ''}`} onClick={() => { setCmd(n); setSub(''); setValues({}); setPositional('') }}>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="mono">{n}</span>
                    <span className="muted small">{c.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title={<span className="mono">opa {cmd}</span>} subtitle={active?.usage ?? command?.description}>
            <div className="stack">
              {subs.length > 0 && (
                <Field label="Subcommand">
                  <select value={sub} onChange={(e) => { setSub(e.target.value); setValues({}) }}>
                    <option value="">(none)</option>
                    {subs.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Arguments" hint="Positional arguments (files, query, …), shell quoting supported.">
                <input className="mono" value={positional} onChange={(e) => setPositional(e.target.value)} placeholder={active?.usage?.replace(/^\S+\s+\S+\s*/, '') ?? ''} />
              </Field>
              <div className="row">
                <strong>{flags.length} flags</strong>
                <input placeholder="Filter flags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="flag-grid">
                {shown.map(([n, f]) => (
                  <div key={n} className="flag">
                    <FlagInput name={n} flag={f} value={values[n]} onChange={(v) => setValues({ ...values, [n]: v })} />
                    <span className="flag-desc">{f.short && <Badge>-{f.short}</Badge>} {f.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card title="Command line" subtitle="Everything after `opa`. Paths are relative to the run directory.">
          <input className="mono" style={{ width: '100%' }} value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run()} />
        </Card>
      )}
      <div className="grid cols-2">
        <Field label="Collect output files" hint="Comma separated glob patterns to download after the run, e.g. bundle.tar.gz, *.json">
          <input className="mono" value={collect} onChange={(e) => setCollect(e.target.value)} />
        </Field>
        <Field label="stdin" hint="Piped to the process (e.g. for --stdin / --stdin-input)">
          <textarea rows={2} value={stdin} onChange={(e) => setStdin(e.target.value)} />
        </Field>
      </div>
      {cmd === 'run' && <Alert kind="info">opa run is handled by the REPL and Local OPA pages.</Alert>}
      {res && (
        <Card title="Output">
          <div className="stack">
            <CliOutput result={res} />
            {Object.entries(res.files ?? {}).map(([n, f]) => (
              <div key={n} className="row">
                <span className="mono">{n}</span>
                <span className="muted small">{bytes(f.size)}</span>
                <Button size="sm" icon="download" onClick={() => download(n.split('/').pop() ?? n, f.base64 ? base64ToBytes(f.base64) : (f.text ?? ''))}>Download</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
