import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { FileInfo } from '../api/types'
import { Editor, languageFor } from '../components/Editor'
import { Icon } from '../components/icons'
import { Alert, Badge, Button, Card, Check, CliOutput, Empty, Field, Modal, useToast } from '../components/ui'
import { hasCommand } from '../lib/features'
import { bytes } from '../lib/format'
import { policyTemplate } from '../lib/templates'
import { useApp, useWorkspace } from '../state/app'
import type { CliResult } from '../api/types'

type Dialog = null | 'newfile' | 'rename' | 'newws' | 'deploy' | 'pull' | 'editws'

export default function WorkspacePage() {
  const { ws, workspaces, setWs, reloadWorkspaces, cli, connections, conn, readOnly, info } = useApp()
  const { files, content, reload, setContent, error } = useWorkspace(ws)
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [buffer, setBuffer] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [template, setTemplate] = useState('rbac')
  const [target, setTarget] = useState(conn)
  const [deployOpts, setDeployOpts] = useState({ policies: true, data: true, includeTests: false, dataPrefix: '' })
  const [steps, setSteps] = useState<{ action: string; target: string; status: number; error?: string }[] | null>(null)
  const [cliRes, setCliRes] = useState<CliResult | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const current = workspaces.find((w) => w.id === ws)

  useEffect(() => {
    if (!open && files.length) {
      const first = files.find((f) => f.path.endsWith('.rego') && !f.path.endsWith('_test.rego')) ?? files[0]
      setOpen(first.path)
    }
  }, [files, open])
  useEffect(() => {
    if (open) setBuffer(content[open] ?? '')
  }, [open, content])
  useEffect(() => {
    setOpen(null)
    setCliRes(null)
  }, [ws])

  const dirty = open !== null && buffer !== (content[open] ?? '')

  const save = async () => {
    if (!open) return
    await api.writeFile(ws, open, buffer)
    setContent({ ...content, [open]: buffer })
    toast(`Saved ${open}`, 'ok')
    void reload()
  }

  const runOnFile = async (args: string[], apply?: boolean) => {
    if (!open) return
    const r = await api.cli({ args: [...args, open], files: { [open]: buffer } })
    setCliRes(r)
    if (apply && r.exitCode === 0 && r.stdout) {
      setBuffer(r.stdout)
      toast('Formatted — review and save', 'ok')
    }
  }

  const tree = useMemo(() => {
    const groups = new Map<string, FileInfo[]>()
    for (const f of files) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
      groups.set(dir, [...(groups.get(dir) ?? []), f])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [files])

  const kindBadge = (k: string) => {
    const map: Record<string, 'ok' | 'info' | 'warn' | 'accent' | undefined> = { rego: 'accent', test: 'ok', data: 'info', input: 'warn' }
    return <Badge kind={map[k]}>{k}</Badge>
  }

  return (
    <div className="page">
      {error && <Alert kind="err">{error}</Alert>}
      <div className="row">
        <h2>{current?.name ?? ws}</h2>
        {current?.description && <span className="muted">{current.description}</span>}
        <div className="right toolbar">
          <Button icon="plus" onClick={() => { setName(''); setDesc(''); setDialog('newws') }} disabled={readOnly}>New workspace</Button>
          <Button icon="edit" onClick={() => { setName(current?.name ?? ''); setDesc(current?.description ?? ''); setDialog('editws') }} disabled={readOnly}>Rename</Button>
          <Button icon="upload" onClick={() => importRef.current?.click()} disabled={readOnly}>Import bundle</Button>
          <a className="btn" href={api.exportUrl(ws)} download><Icon name="download" />Export bundle</a>
          <Button icon="cloud" onClick={() => { setSteps(null); setTarget(conn); setDialog('pull') }} disabled={readOnly}>Pull from OPA</Button>
          <Button icon="upload" variant="primary" onClick={() => { setSteps(null); setTarget(conn); setDialog('deploy') }} disabled={readOnly}>Deploy to OPA</Button>
        </div>
      </div>
      <input ref={importRef} type="file" accept=".tar.gz,.tgz,application/gzip" hidden onChange={async (e) => {
        const f = e.target.files?.[0]
        if (!f) return
        try {
          const r = await api.importArchive(ws, f)
          toast(`Imported ${r.imported.length} files`, 'ok')
          void reload()
        } catch (err) {
          toast((err as Error).message, 'err')
        }
        e.target.value = ''
      }} />
      <input ref={uploadRef} type="file" multiple hidden onChange={async (e) => {
        for (const f of Array.from(e.target.files ?? [])) await api.writeFile(ws, f.name, await f.text())
        toast('Uploaded', 'ok')
        void reload()
        e.target.value = ''
      }} />

      <div className="split sidebar-left">
        <Card
          title={`Files (${files.length})`}
          flush
          actions={
            <>
              <Button size="sm" icon="upload" onClick={() => uploadRef.current?.click()} disabled={readOnly} title="Upload files" />
              <Button size="sm" icon="plus" variant="primary" onClick={() => { setName('policies/new.rego'); setDialog('newfile') }} disabled={readOnly}>File</Button>
            </>
          }
        >
          <div className="list" style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
            {tree.map(([dir, list]) => (
              <div key={dir}>
                {dir && <div className="list-item" style={{ cursor: 'default', color: 'var(--muted)' }}><Icon name="folder" /><span className="small">{dir}/</span></div>}
                {list.map((f) => (
                  <div key={f.path} className={`list-item ${f.path === open ? 'active' : ''}`} style={{ paddingLeft: dir ? 28 : 12 }} onClick={() => setOpen(f.path)}>
                    <Icon name="file" />
                    <span className="ellipsis grow small mono">{f.path.split('/').pop()}</span>
                    {kindBadge(f.kind)}
                  </div>
                ))}
              </div>
            ))}
            {!files.length && <Empty title="Empty workspace">Create or upload files.</Empty>}
          </div>
        </Card>
        <div className="stack">
          {open ? (
            <Card
              title={<span className="mono">{open}{dirty ? ' •' : ''}</span>}
              subtitle={`${bytes(files.find((f) => f.path === open)?.size ?? 0)} · ${languageFor(open)}`}
              actions={
                <>
                  {open.endsWith('.rego') && hasCommand(cli, 'fmt') && <Button size="sm" icon="format" onClick={() => void runOnFile(['fmt'], true)}>Format</Button>}
                  {open.endsWith('.rego') && hasCommand(cli, 'check') && <Button size="sm" icon="check" onClick={() => void runOnFile(['check'])}>Check</Button>}
                  <Button size="sm" icon="edit" onClick={() => { setName(open); setDialog('rename') }} disabled={readOnly}>Rename</Button>
                  <Button size="sm" icon="trash" variant="danger" disabled={readOnly} onClick={async () => {
                    if (!window.confirm(`Delete ${open}?`)) return
                    await api.deleteFile(ws, open)
                    setOpen(null)
                    void reload()
                  }} />
                  <Button size="sm" icon="save" variant="primary" disabled={!dirty || readOnly} onClick={() => void save()}>Save</Button>
                </>
              }
            >
              <Editor value={buffer} onChange={setBuffer} language={languageFor(open)} height="calc(100vh - 330px)" onSubmit={() => void save()} readOnly={readOnly} />
            </Card>
          ) : (
            <Card><Empty title="No file selected" icon="file" /></Card>
          )}
          {cliRes && <Card title={<span className="mono">{cliRes.command.join(' ')}</span>} actions={<Button size="sm" icon="x" onClick={() => setCliRes(null)} />}><CliOutput result={cliRes} hideStdout={cliRes.command[1] === 'fmt' && cliRes.exitCode === 0} /></Card>}
        </div>
      </div>

      {dialog === 'newfile' && (
        <Modal title="New file" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
          const pkg = name.replace(/\.rego$/, '').replace(/\//g, '.').replace(/[^a-zA-Z0-9_.]/g, '_')
          const initial = name.endsWith('.rego') ? policyTemplate(cli?.preferred_dialect, pkg) : name.endsWith('.json') ? '{}\n' : ''
          await api.writeFile(ws, name, initial)
          setDialog(null)
          await reload()
          setOpen(name)
        }}>Create</Button></>}>
          <Field label="Path" hint=".rego policies and tests (*_test.rego), data.json / data.yaml documents, input*.json inputs, .manifest">
            <input className="mono" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
      {dialog === 'rename' && open && (
        <Modal title="Rename file" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
          await api.renameFile(ws, open, name)
          setDialog(null)
          setOpen(name)
          void reload()
        }}>Rename</Button></>}>
          <Field label="New path"><input className="mono" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        </Modal>
      )}
      {(dialog === 'newws' || dialog === 'editws') && (
        <Modal title={dialog === 'newws' ? 'New workspace' : 'Edit workspace'} onClose={() => setDialog(null)} footer={
          <>
            {dialog === 'editws' && <Button variant="danger" icon="trash" onClick={async () => {
              if (!window.confirm(`Delete workspace ${current?.name}? All files are removed.`)) return
              await api.deleteWorkspace(ws)
              setDialog(null)
              await reloadWorkspaces()
            }}>Delete workspace</Button>}
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" onClick={async () => {
              try {
                if (dialog === 'newws') {
                  const w = await api.createWorkspace({ name, description: desc, template })
                  await reloadWorkspaces()
                  setWs(w.id)
                } else {
                  await api.updateWorkspace(ws, { name, description: desc })
                  await reloadWorkspaces()
                }
                setDialog(null)
              } catch (e) {
                toast((e as Error).message, 'err')
              }
            }}>{dialog === 'newws' ? 'Create' : 'Save'}</Button>
          </>
        }>
          <div className="stack">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field label="Description"><input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            {dialog === 'newws' && (
              <Field label="Template" hint={`Written in the Rego dialect of OPA ${info.opa.version ?? info.studio.targetOpaVersion}.`}>
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="rbac">RBAC example (policy, data, input, tests)</option>
                  <option value="empty">Empty</option>
                </select>
              </Field>
            )}
          </div>
        </Modal>
      )}
      {(dialog === 'deploy' || dialog === 'pull') && (
        <Modal title={dialog === 'deploy' ? 'Deploy workspace to OPA' : 'Pull from OPA into workspace'} onClose={() => setDialog(null)} footer={
          <>
            <Button onClick={() => setDialog(null)}>Close</Button>
            <Button variant="primary" onClick={async () => {
              try {
                if (dialog === 'deploy') {
                  const r = await api.deploy(ws, { connection: target, ...deployOpts })
                  setSteps(r.steps)
                  toast(r.ok ? 'Deployed' : 'Deployed with errors', r.ok ? 'ok' : 'err')
                } else {
                  const r = await api.pull(ws, { connection: target, policies: deployOpts.policies, data: deployOpts.data })
                  toast(`Pulled ${r.written.length} files`, 'ok')
                  setSteps(r.written.map((w) => ({ action: 'write', target: w, status: 200 })))
                  void reload()
                }
              } catch (e) {
                toast((e as Error).message, 'err')
              }
            }}>{dialog === 'deploy' ? 'Deploy' : 'Pull'}</Button>
          </>
        }>
          <div className="stack">
            <Field label="OPA server">
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.url}</option>)}
              </select>
            </Field>
            <div className="row">
              <Check label="Policies (*.rego)" checked={deployOpts.policies} onChange={(v) => setDeployOpts({ ...deployOpts, policies: v })} />
              <Check label="Data (data.json / data.yaml)" checked={deployOpts.data} onChange={(v) => setDeployOpts({ ...deployOpts, data: v })} />
              {dialog === 'deploy' && <Check label="Include tests" checked={deployOpts.includeTests} onChange={(v) => setDeployOpts({ ...deployOpts, includeTests: v })} />}
            </div>
            {dialog === 'deploy' && (
              <Field label="Data prefix" hint="Mount workspace data below this path. Empty + a root data.json replaces the server's whole data document.">
                <input className="mono" value={deployOpts.dataPrefix} onChange={(e) => setDeployOpts({ ...deployOpts, dataPrefix: e.target.value })} />
              </Field>
            )}
            {steps && (
              <table className="table">
                <thead><tr><th>Step</th><th>Target</th><th>Status</th></tr></thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}><td>{s.action}</td><td className="mono small">{s.target}{s.error && <div className="small" style={{ color: 'var(--err)', whiteSpace: 'pre-wrap' }}>{s.error}</div>}</td><td><Badge kind={s.error ? 'err' : 'ok'}>{s.status || 'error'}</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
