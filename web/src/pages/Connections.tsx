import { useState } from 'react'
import { api } from '../api/client'
import type { Connection, ProbeResult } from '../api/types'
import { Alert, Badge, Button, Card, Check, Field, Modal, useToast } from '../components/ui'
import { useApp } from '../state/app'

const EMPTY: Partial<Connection> = { name: '', url: 'http://localhost:8181', token: '', headers: {}, insecureSkipVerify: false }

export default function Connections() {
  const { connections, reloadConnections, conn, setConn, readOnly } = useApp()
  const toast = useToast()
  const [edit, setEdit] = useState<Partial<Connection> | null>(null)
  const [headers, setHeaders] = useState('')
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})

  const open = (c?: Connection) => {
    const v = c ? { ...c } : { ...EMPTY }
    setEdit(v)
    setHeaders(Object.entries(v.headers ?? {}).map(([k, x]) => `${k}: ${x}`).join('\n'))
  }

  const save = async () => {
    if (!edit) return
    const h: Record<string, string> = {}
    headers.split('\n').forEach((l) => {
      const i = l.indexOf(':')
      if (i > 0) h[l.slice(0, i).trim()] = l.slice(i + 1).trim()
    })
    try {
      const body = { ...edit, headers: h }
      if (edit.id) await api.updateConnection(edit.id, body)
      else {
        const c = await api.createConnection(body)
        setConn(c.id)
      }
      setEdit(null)
      await reloadConnections()
      toast('Connection saved', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const test = async (id: string) => {
    const p = await api.testConnection(id)
    setProbes((x) => ({ ...x, [id]: p }))
  }

  return (
    <div className="page">
      <Card title="OPA servers" subtitle="Requests are proxied by the Studio backend, so OPA does not need CORS and tokens never reach the browser." actions={<Button icon="plus" variant="primary" disabled={readOnly} onClick={() => open()}>Add connection</Button>} flush>
        <table className="table">
          <thead><tr><th>Name</th><th>URL</th><th>Source</th><th>Auth</th><th>Status</th><th /></tr></thead>
          <tbody>
            {connections.map((c) => {
              const p = probes[c.id]
              return (
                <tr key={c.id} className={c.id === conn ? 'selected' : ''}>
                  <td>{c.name}{c.id === conn && <> <Badge kind="accent">active</Badge></>}</td>
                  <td className="mono small">{c.url}</td>
                  <td><Badge>{c.source}</Badge></td>
                  <td>{c.token ? <Badge kind="info">bearer</Badge> : c.clientCert ? <Badge kind="info">mTLS</Badge> : '—'}</td>
                  <td>{p ? (p.reachable ? <Badge kind="ok">{p.version ?? 'reachable'} · {p.latencyMs} ms</Badge> : <Badge kind="err" title={p.error}>down</Badge>) : '—'}</td>
                  <td>
                    <div className="row nowrap">
                      <Button size="sm" onClick={() => void test(c.id)}>Test</Button>
                      <Button size="sm" onClick={() => setConn(c.id)} disabled={c.id === conn}>Use</Button>
                      {c.source === 'user' && <Button size="sm" icon="edit" disabled={readOnly} onClick={() => open(c)} />}
                      {c.source === 'user' && <Button size="sm" icon="trash" variant="danger" disabled={readOnly} onClick={async () => { if (window.confirm(`Delete ${c.name}?`)) { await api.deleteConnection(c.id); await reloadConnections() } }} />}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
      <Alert kind="info">
        Connections can also be declared in configuration with <code>OPA_STUDIO_CONNECTIONS</code> (JSON array or <code>@file.json</code>); those are read-only here.
      </Alert>
      {edit && (
        <Modal title={edit.id ? 'Edit connection' : 'New connection'} onClose={() => setEdit(null)} width={700} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
          <div className="stack">
            <div className="grid cols-2">
              <Field label="Name"><input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="URL" hint="Base URL of the OPA server, optionally with a path prefix"><input className="mono" value={edit.url ?? ''} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            </div>
            <Field label="Bearer token" hint="For OPA started with --authentication=token. Stored server-side with mode 0600."><input type="password" value={edit.token ?? ''} onChange={(e) => setEdit({ ...edit, token: e.target.value })} /></Field>
            <Field label="Extra headers" hint="One per line: Name: value"><textarea rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} /></Field>
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>TLS</summary>
              <div className="stack" style={{ marginTop: 8 }}>
                <Field label="CA certificate (PEM)"><textarea rows={3} value={edit.caCert ?? ''} onChange={(e) => setEdit({ ...edit, caCert: e.target.value })} /></Field>
                <div className="grid cols-2">
                  <Field label="Client certificate (PEM)"><textarea rows={3} value={edit.clientCert ?? ''} onChange={(e) => setEdit({ ...edit, clientCert: e.target.value })} /></Field>
                  <Field label="Client key (PEM)"><textarea rows={3} value={edit.clientKey ?? ''} onChange={(e) => setEdit({ ...edit, clientKey: e.target.value })} /></Field>
                </div>
                <Check label="Skip certificate verification (insecure)" checked={!!edit.insecureSkipVerify} onChange={(v) => setEdit({ ...edit, insecureSkipVerify: v })} />
              </div>
            </details>
          </div>
        </Modal>
      )}
    </div>
  )
}
