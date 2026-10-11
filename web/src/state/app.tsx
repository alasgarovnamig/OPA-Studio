import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Connection, FileInfo, Info, Manifest, ProbeResult, Workspace } from '../api/types'

function load(key: string, def: string): string {
  try {
    return localStorage.getItem(key) ?? def
  } catch {
    return def
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* storage unavailable */
  }
}

interface AppState {
  info: Info
  /** Manifest of the OPA binary bundled with Studio (CLI features). */
  cli: Manifest | null
  /** Manifest matching the connected server's version (server features). */
  server: Manifest | null
  serverVersion?: string
  connections: Connection[]
  conn: string
  setConn: (id: string) => void
  probe: ProbeResult | null
  reprobe: () => Promise<void>
  reloadConnections: () => Promise<void>
  workspaces: Workspace[]
  ws: string
  setWs: (id: string) => void
  reloadWorkspaces: () => Promise<void>
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  readOnly: boolean
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

export function AppProvider({ info, children }: { info: Info; children: ReactNode }) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [conn, setConnState] = useState(() => load('studio.conn', 'local'))
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [server, setServer] = useState<Manifest | null>(info.manifest)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [ws, setWsState] = useState(() => load('studio.ws', 'default'))
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => (load('studio.theme', 'light') as 'light' | 'dark'))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const reloadConnections = useCallback(async () => {
    const list = await api.connections()
    setConnections(list)
    if (list.length && !list.some((c) => c.id === conn)) setConnState(list[0].id)
  }, [conn])

  const reloadWorkspaces = useCallback(async () => {
    const list = await api.workspaces()
    setWorkspaces(list)
    if (list.length && !list.some((w) => w.id === ws)) setWsState(list[0].id)
  }, [ws])

  const reprobe = useCallback(async () => {
    if (!conn) return
    try {
      const p = await api.testConnection(conn)
      setProbe(p)
      if (p.version && p.version !== info.manifest?.opa.version) {
        try {
          setServer(await api.versionManifest(p.version))
        } catch {
          setServer(info.manifest)
        }
      } else {
        setServer(info.manifest)
      }
    } catch {
      setProbe(null)
    }
  }, [conn, info.manifest])

  useEffect(() => {
    void reloadConnections()
    void reloadWorkspaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setProbe(null)
    void reprobe()
  }, [reprobe])

  const value = useMemo<AppState>(
    () => ({
      info,
      cli: info.manifest,
      server,
      serverVersion: probe?.version,
      connections,
      conn,
      setConn: (id) => {
        save('studio.conn', id)
        setConnState(id)
      },
      probe,
      reprobe,
      reloadConnections,
      workspaces,
      ws,
      setWs: (id) => {
        save('studio.ws', id)
        setWsState(id)
      },
      reloadWorkspaces,
      theme,
      setTheme: (t) => {
        save('studio.theme', t)
        setThemeState(t)
      },
      readOnly: info.settings.readOnly,
    }),
    [info, server, probe, connections, conn, reprobe, reloadConnections, workspaces, ws, reloadWorkspaces, theme],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Loads the files (and contents) of a workspace. */
export function useWorkspace(id: string) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [content, setContent] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const r = await api.filesWithContent(id)
      setFiles(r.files)
      setContent(r.content)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => {
    void reload()
  }, [reload])
  return { files, content, loading, error, reload, setContent }
}

/** Policy, test and data files OPA should load from a workspace (inputs excluded). */
export function loadableFiles(files: FileInfo[]): string[] {
  return files
    .map((f) => f.path)
    .filter((p) => {
      const base = p.split('/').pop() ?? p
      if (base.startsWith('input')) return false
      return p.endsWith('.rego') || base === 'data.json' || base === 'data.yaml' || base === 'data.yml'
    })
}

/**
 * Arguments that load a workspace the way OPA loads a directory. Releases with
 * --ignore get "." (keeping directory based data namespacing); older ones get
 * explicit files.
 */
export function loadArgs(m: Manifest | null, cmd: string, files: FileInfo[], flag = '-d', opts: { tests?: boolean } = {}): string[] {
  const supportsIgnore = !!m?.cli?.commands?.[cmd]?.flags?.ignore
  const keepTests = opts.tests ?? true
  if (supportsIgnore) {
    const out = [flag === '' ? '.' : flag, ...(flag === '' ? [] : ['.']), '--ignore', 'input*.json']
    if (!keepTests) out.push('--ignore', '*_test.rego')
    return out
  }
  // Early releases accept a single --data value; load the whole directory then.
  if (flag === '-d' && m?.cli?.commands?.[cmd]?.flags?.data?.type === 'string') return ['-d', '.']
  const list = loadableFiles(files).filter((p) => keepTests || !p.endsWith('_test.rego'))
  if (flag === '') return list
  return list.flatMap((p) => [flag, p])
}
