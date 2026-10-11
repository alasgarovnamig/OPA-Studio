import type {
  BundleMeta, BundleSummary, CliRequest, CliResult, Connection, Decision, Discovery, FileInfo, Info,
  LocalSettings, LocalState, LogLine, Manifest, ProbeResult, ReplEvent, StatusReport, VersionEntry, Workspace,
} from './types'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

let unauthorizedHandler: (() => void) | null = null
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) }
  let payload: BodyInit | undefined
  if (body instanceof Blob || body instanceof ArrayBuffer || typeof body === 'string') {
    payload = body as BodyInit
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, { ...init, method, headers, body: payload, credentials: 'same-origin' })
  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler()
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    /* plain text */
  }
  if (!res.ok && res.status !== 207) {
    const msg = (data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : text) || res.statusText
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}

const enc = encodeURIComponent
const encPath = (p: string) => p.split('/').map(enc).join('/')

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  login: (token: string) => request<{ ok: boolean }>('POST', '/api/auth', { token }),
  logout: () => request<{ ok: boolean }>('DELETE', '/api/auth'),
  versions: () => request<VersionEntry[]>('GET', '/api/versions'),
  versionManifest: (v: string) => request<Manifest>('GET', `/api/versions/${enc(v)}/manifest`),

  connections: () => request<Connection[]>('GET', '/api/connections'),
  createConnection: (c: Partial<Connection>) => request<Connection>('POST', '/api/connections', c),
  updateConnection: (id: string, c: Partial<Connection>) => request<Connection>('PUT', `/api/connections/${enc(id)}`, c),
  deleteConnection: (id: string) => request<void>('DELETE', `/api/connections/${enc(id)}`),
  testConnection: (id: string) => request<ProbeResult>('POST', `/api/connections/${enc(id)}/test`),

  cli: (req: CliRequest) => request<CliResult>('POST', '/api/cli/run', req),

  workspaces: () => request<Workspace[]>('GET', '/api/workspaces'),
  createWorkspace: (w: { id?: string; name: string; description?: string; template?: string; files?: Record<string, string> }) =>
    request<Workspace>('POST', '/api/workspaces', w),
  updateWorkspace: (id: string, w: { name: string; description?: string }) => request<Workspace>('PUT', `/api/workspaces/${enc(id)}`, w),
  deleteWorkspace: (id: string) => request<void>('DELETE', `/api/workspaces/${enc(id)}`),
  files: (id: string) => request<FileInfo[]>('GET', `/api/workspaces/${enc(id)}/files`),
  filesWithContent: (id: string) => request<{ files: FileInfo[]; content: Record<string, string> }>('GET', `/api/workspaces/${enc(id)}/files?content=true`),
  readFile: async (id: string, path: string) => {
    const res = await fetch(`/api/workspaces/${enc(id)}/files/${encPath(path)}`, { credentials: 'same-origin' })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.text()
  },
  writeFile: (id: string, path: string, content: string) =>
    request<void>('PUT', `/api/workspaces/${enc(id)}/files/${encPath(path)}`, content, { headers: { 'Content-Type': 'text/plain' } }),
  deleteFile: (id: string, path: string) => request<void>('DELETE', `/api/workspaces/${enc(id)}/files/${encPath(path)}`),
  renameFile: (id: string, from: string, to: string) => request<void>('POST', `/api/workspaces/${enc(id)}/rename`, { from, to }),
  exportUrl: (id: string, revision?: string) => `/api/workspaces/${enc(id)}/export${revision ? `?revision=${enc(revision)}` : ''}`,
  importArchive: (id: string, data: Blob) =>
    request<{ imported: string[] }>('POST', `/api/workspaces/${enc(id)}/import`, data, { headers: { 'Content-Type': 'application/gzip' } }),
  deploy: (id: string, body: { connection: string; policies: boolean; data: boolean; dataPrefix?: string; includeTests?: boolean }) =>
    request<{ ok: boolean; steps: { action: string; target: string; status: number; error?: string }[] }>('POST', `/api/workspaces/${enc(id)}/deploy`, body),
  pull: (id: string, body: { connection: string; policies: boolean; data: boolean; dataPath?: string }) =>
    request<{ written: string[] }>('POST', `/api/workspaces/${enc(id)}/pull`, body),
  inspectArchive: (data: Blob) => request<BundleSummary>('POST', '/api/bundles/inspect', data, { headers: { 'Content-Type': 'application/gzip' } }),

  localState: () => request<{ enabled: boolean; state?: LocalState; settings?: LocalSettings; preview?: string[]; previewError?: string }>('GET', '/api/local-opa'),
  localSettings: (s: LocalSettings) => request<{ enabled: boolean; state: LocalState; settings: LocalSettings; preview: string[] }>('PUT', '/api/local-opa/settings', s),
  localAction: (action: 'start' | 'stop' | 'restart') => request<{ state: LocalState }>('POST', `/api/local-opa/${action}`),
  localLogs: (after = 0) => request<LogLine[]>('GET', `/api/local-opa/logs?after=${after}`),
  clearLocalLogs: () => request<void>('DELETE', '/api/local-opa/logs'),

  replStart: (body: { workspace?: string; args?: string[] }) => request<{ id: string }>('POST', '/api/repl', body),
  replInput: (id: string, line: string) => request<void>('POST', `/api/repl/${enc(id)}/input`, { line }),
  replEvents: (id: string, after: number) => request<ReplEvent[]>('GET', `/api/repl/${enc(id)}/events?after=${after}`),
  replClose: (id: string) => request<void>('DELETE', `/api/repl/${enc(id)}`),

  cpBundles: () => request<BundleMeta[]>('GET', '/api/control/bundles'),
  cpPublishWorkspace: (name: string, body: { workspace: string; revision?: string; roots?: string[] }) =>
    request<BundleMeta>('POST', `/api/control/bundles/${enc(name)}`, body),
  cpPublishArchive: (name: string, data: Blob) =>
    request<BundleMeta>('POST', `/api/control/bundles/${enc(name)}`, data, { headers: { 'Content-Type': 'application/gzip' } }),
  cpDeleteBundle: (name: string) => request<void>('DELETE', `/api/control/bundles/${enc(name)}`),
  cpInspectBundle: (name: string) => request<BundleSummary>('GET', `/api/control/bundles/${enc(name)}/inspect`),
  cpBundleUrl: (name: string) => `/api/control/bundles/${enc(name)}/download`,
  cpDiscovery: () => request<Discovery[]>('GET', '/api/control/discovery'),
  cpPutDiscovery: (name: string, d: { decision: string; config: unknown }) => request<Discovery>('PUT', `/api/control/discovery/${enc(name)}`, d),
  cpDeleteDiscovery: (name: string) => request<void>('DELETE', `/api/control/discovery/${enc(name)}`),
  cpDecisions: (q: { path?: string; search?: string; limit?: number; offset?: number }) => {
    const p = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)))
    return request<{ total: number; items: Decision[] }>('GET', `/api/control/decisions?${p}`)
  },
  cpClearDecisions: () => request<void>('DELETE', '/api/control/decisions'),
  cpStatuses: (instance?: string) => request<StatusReport[]>('GET', `/api/control/status${instance ? `?instance=${enc(instance)}` : ''}`),
  cpInstances: () => request<StatusReport[]>('GET', '/api/control/instances'),
  cpClearStatuses: () => request<void>('DELETE', '/api/control/status'),
  cpConfig: async (q: Record<string, string>) => {
    const res = await fetch(`/api/control/config?${new URLSearchParams(q)}`, { credentials: 'same-origin' })
    return res.text()
  },
}

// ---- OPA REST calls through the Studio proxy -------------------------------------

export interface OpaResponse<T = unknown> {
  status: number
  ok: boolean
  durationMs: number
  headers: Record<string, string>
  text: string
  json?: T
  target?: string
  proxyError?: boolean
}

export interface OpaRequestOptions {
  body?: unknown
  raw?: string
  query?: Record<string, string | number | boolean | undefined | null | string[]>
  headers?: Record<string, string>
  contentType?: string
}

export function buildQuery(query?: OpaRequestOptions['query']): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === false || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => parts.push(`${enc(k)}=${enc(x)}`))
    else if (v === true) parts.push(enc(k))
    else parts.push(`${enc(k)}=${enc(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/**
 * opa performs an HTTP request against the selected OPA server. Boolean
 * `true` query values are sent as bare flags (e.g. ?pretty, ?bundles) which
 * every OPA release understands.
 */
export async function opa<T = unknown>(conn: string, method: string, path: string, o: OpaRequestOptions = {}): Promise<OpaResponse<T>> {
  const headers: Record<string, string> = {}
  let body: BodyInit | undefined
  if (o.raw !== undefined) {
    body = o.raw
    headers['Content-Type'] = o.contentType ?? 'text/plain'
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body)
    headers['Content-Type'] = o.contentType ?? 'application/json'
  }
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (['content-type', 'accept', 'if-none-match', 'if-match'].includes(k.toLowerCase())) headers[k] = v
    else headers[`X-Opa-Header-${k}`] = v
  }
  const url = `/api/connections/${enc(conn)}/proxy/${path.replace(/^\//, '')}${buildQuery(o.query)}`
  const started = performance.now()
  const res = await fetch(url, { method, headers, body, credentials: 'same-origin' })
  if (res.status === 401 && unauthorizedHandler && !res.headers.get('X-Studio-Upstream-Status')) unauthorizedHandler()
  const text = await res.text()
  const out: OpaResponse<T> = {
    status: res.status,
    ok: res.ok,
    durationMs: Number(res.headers.get('X-Studio-Duration-Ms') ?? Math.round(performance.now() - started)),
    headers: Object.fromEntries(res.headers.entries()),
    text,
    target: res.headers.get('X-Studio-Target') ?? undefined,
  }
  try {
    out.json = text ? (JSON.parse(text) as T) : undefined
  } catch {
    /* not JSON */
  }
  if (!res.headers.get('X-Studio-Upstream-Status') && out.json && typeof out.json === 'object' && 'studioProxyError' in (out.json as object)) {
    out.proxyError = true
  }
  return out
}

/** Extracts a human readable error from an OPA error response. */
export function opaError(r: OpaResponse): string | null {
  if (r.ok) return null
  const j = r.json as Record<string, unknown> | undefined
  if (j && typeof j === 'object') {
    const msg = (j.message ?? j.Message ?? j.error) as string | undefined
    const errs = (j.errors as { message: string; location?: { file: string; row: number; col: number } }[] | undefined) ?? []
    const lines = errs.map((e) => (e.location ? `${e.location.file}:${e.location.row}:${e.location.col}: ${e.message}` : e.message))
    return [msg ?? `HTTP ${r.status}`, ...lines].join('\n')
  }
  return r.text || `HTTP ${r.status}`
}

/** Subscribes to a Server-Sent Events endpoint. Returns an unsubscribe function. */
export function stream<T>(url: string, onEvent: (e: T) => void, onError?: () => void): () => void {
  const es = new EventSource(url, { withCredentials: true })
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as T)
    } catch {
      /* ignore malformed frames */
    }
  }
  es.onerror = () => onError?.()
  return () => es.close()
}
