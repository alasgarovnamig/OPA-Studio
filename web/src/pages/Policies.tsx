import { useCallback, useEffect, useMemo, useState } from 'react'
import { opa, opaError, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { Icon } from '../components/icons'
import { normalizePolicies, policyPath, ResponseView, unwrap, type PolicyEntry } from '../components/opa'
import { Alert, Button, Card, Check, Empty, Field, JsonView, Modal, Tabs, useToast } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { policyTemplate } from '../lib/templates'
import { useApp } from '../state/app'

type Tab = 'source' | 'ast' | 'response'

export default function Policies() {
  const { conn, server, readOnly } = useApp()
  const toast = useToast()
  const [list, setList] = useState<PolicyEntry[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [original, setOriginal] = useState('')
  const [ast, setAst] = useState<unknown>(undefined)
  const [resp, setResp] = useState<OpaResponse | null>(null)
  const [tab, setTab] = useState<Tab>('source')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newId, setNewId] = useState('example.rego')
  const [metrics, setMetrics] = useState(false)
  const [busy, setBusy] = useState(false)
  const [style, setStyle] = useState<'encoded' | 'path'>('encoded')

  // Sends a policy request, falling back to path-style ids for older routers.
  const policyRequest = useCallback(
    async (method: string, id: string, o: Parameters<typeof opa>[3] = {}) => {
      let r = await opa(conn, method, policyPath(id, style), o)
      if (r.status === 404 && r.json === undefined && id.includes('/')) {
        const alt = style === 'encoded' ? 'path' : 'encoded'
        const r2 = await opa(conn, method, policyPath(id, alt), o)
        if (r2.status !== 404 || r2.json !== undefined) {
          setStyle(alt)
          r = r2
        }
      }
      return r
    },
    [conn, style],
  )

  const refresh = useCallback(async () => {
    const r = await opa(conn, 'GET', '/v1/policies')
    if (!r.ok) {
      setError(opaError(r))
      setList([])
      return
    }
    setError(null)
    setList(normalizePolicies(r.json).sort((a, b) => a.id.localeCompare(b.id)))
  }, [conn])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = useCallback(
    async (id: string) => {
      setSelected(id)
      const r = await policyRequest('GET', id)
      setResp(r)
      const p = r.ok ? normalizePolicies({ result: [unwrap(r.json)] })[0] : undefined
      setSource(p?.raw ?? '')
      setOriginal(p?.raw ?? '')
      setAst(p?.ast)
    },
    [policyRequest],
  )

  const save = async (id: string, content: string) => {
    setBusy(true)
    const r = await policyRequest('PUT', id, { raw: content, query: { metrics } })
    setBusy(false)
    setResp(r)
    if (r.ok) {
      toast(`Policy ${id} saved`, 'ok')
      setOriginal(content)
      await refresh()
      await open(id)
    } else {
      setTab('response')
      toast(`Save failed: HTTP ${r.status}`, 'err')
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm(`Delete policy ${id}?`)) return
    const r = await policyRequest('DELETE', id)
    setResp(r)
    if (r.ok) {
      toast(`Policy ${id} deleted`, 'ok')
      setSelected(null)
      setSource('')
      await refresh()
    } else toast(opaError(r) ?? 'Delete failed', 'err')
  }

  const filtered = useMemo(() => list.filter((p) => p.id.toLowerCase().includes(filter.toLowerCase())), [list, filter])
  const dirty = source !== original
  const canWrite = !readOnly && hasEndpoint(server, 'policies_put') !== false

  return (
    <div className="page">
      {error && <Alert kind="err" title="Cannot list policies"><pre>{error}</pre></Alert>}
      <div className="split sidebar-left">
        <Card
          title={`Policies (${list.length})`}
          flush
          actions={
            <>
              <Button size="sm" icon="refresh" onClick={() => void refresh()} />
              <Button size="sm" icon="plus" variant="primary" disabled={!canWrite} onClick={() => setCreating(true)}>New</Button>
            </>
          }
        >
          <div style={{ padding: 10 }}>
            <input placeholder="Filter by id…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="list" style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}>
            {filtered.map((p) => (
              <div key={p.id} className={`list-item ${p.id === selected ? 'active' : ''}`} onClick={() => void open(p.id)}>
                <Icon name="file" />
                <span className="ellipsis mono small" title={p.id}>{p.id}</span>
              </div>
            ))}
            {!filtered.length && <Empty title="No policies">Create one, or deploy a workspace.</Empty>}
          </div>
        </Card>

        <div className="stack">
          {selected ? (
            <Card
              title={<span className="mono">{selected}</span>}
              actions={
                <>
                  <Check label="?metrics" checked={metrics} onChange={setMetrics} title="Return compilation metrics" />
                  <Button icon="save" variant="primary" disabled={!canWrite || !dirty || busy} onClick={() => void save(selected, source)}>Save</Button>
                  <Button icon="trash" variant="danger" disabled={!canWrite} onClick={() => void remove(selected)}>Delete</Button>
                </>
              }
              flush
            >
              <Tabs
                tabs={[
                  { id: 'source', label: dirty ? 'Source •' : 'Source' },
                  { id: 'ast', label: 'AST' },
                  { id: 'response', label: 'Last response' },
                ]}
                value={tab}
                onChange={setTab}
              />
              <div className="card-body">
                {tab === 'source' && (
                  original === '' && ast !== undefined && !source ? (
                    <Alert kind="info">This OPA release does not return policy source; see the AST tab.</Alert>
                  ) : (
                    <Editor value={source} onChange={setSource} language="rego" height="calc(100vh - 300px)" readOnly={!canWrite} onSubmit={() => canWrite && void save(selected, source)} />
                  )
                )}
                {tab === 'ast' && <JsonView value={ast} open={3} maxHeight={640} />}
                {tab === 'response' && resp && <ResponseView r={resp} />}
              </div>
            </Card>
          ) : (
            <Card>
              <Empty title="Select a policy" icon="policy">
                Policies are Rego modules stored on the OPA server under an id (usually a file path). Ctrl/⌘+Enter saves.
              </Empty>
            </Card>
          )}
        </div>
      </div>

      {creating && (
        <Modal
          title="New policy"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  setCreating(false)
                  await save(newId, policyTemplate(server?.preferred_dialect ?? 'v1', newId.replace(/\.rego$/, '').replace(/[^a-zA-Z0-9_]/g, '_')))
                }}
              >
                Create
              </Button>
            </>
          }
        >
          <Field label="Policy id" hint="PUT /v1/policies/{id}. The starter module uses the Rego dialect of this OPA version.">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  )
}
