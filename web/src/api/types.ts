export interface Flag {
  short?: string
  type: string
  description: string
  default?: string
  global?: boolean
}

export interface Command {
  description: string
  long?: string
  usage?: string
  flags: Record<string, Flag>
  subcommands?: Record<string, Command>
}

export interface Endpoint {
  method: string
  path: string
  status: number
  content_type?: string
  keys?: string[]
}

export interface Builtin {
  name: string
  infix?: string
  args?: (string | null)[] | null
  result?: string | null
  nondeterministic?: boolean
  relation?: boolean
  categories?: string[] | null
  description?: string | null
}

export interface Capabilities {
  builtins: Builtin[]
  future_keywords?: string[] | null
  features?: string[] | null
  wasm_abi_versions?: { version: number; minor_version: number }[] | null
  allow_net?: string[] | null
}

export interface Manifest {
  schema: number
  opa: { version: string; published_at?: string; prerelease?: boolean; github_release?: boolean }
  version_output?: Record<string, string>
  cli: { commands: Record<string, Command>; root_flags?: Record<string, Flag> }
  dialects?: { cli: Record<string, boolean | null>; server: Record<string, boolean> }
  preferred_dialect?: string
  cli_features?: Record<string, { ok: boolean; rc: number }>
  server?: { started: boolean; preferred_dialect?: string; endpoints: Record<string, Endpoint>; quirks?: Record<string, boolean> }
  capabilities?: Capabilities | null
  live?: boolean
}

export interface Info {
  studio: { version: string; commit: string; date: string; targetOpaVersion: string; startedAt: string }
  opa: { available: boolean; path?: string; version?: string; matchesTarget: boolean; manifestVersion?: string; manifestLive: boolean }
  settings: {
    readOnly: boolean
    authMode: 'none' | 'basic' | 'token'
    cliSandbox: boolean
    localOpa: boolean
    publicUrl: string
    controlPlaneTokenRequired: boolean
  }
  manifest: Manifest | null
}

export interface VersionEntry {
  tag: string
  published_at: string
  prerelease: boolean
  github_release: boolean
  release_url: string
  assets: string[]
  docker_image?: string
  highlights?: { type: 'heading' | 'item'; text: string }[]
}

export interface Connection {
  id: string
  name: string
  url: string
  token?: string
  headers?: Record<string, string>
  caCert?: string
  clientCert?: string
  clientKey?: string
  insecureSkipVerify?: boolean
  source: 'local' | 'config' | 'user'
}

export interface ProbeResult {
  reachable: boolean
  version?: string
  versionSource?: string
  healthy?: boolean
  latencyMs: number
  error?: string
  url: string
}

export interface Workspace {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  files: number
}

export interface FileInfo {
  path: string
  size: number
  modified: string
  kind: string
}

export interface CliFile {
  size: number
  text?: string
  base64?: string
}

export interface CliResult {
  command: string[]
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  truncated: boolean
  files?: Record<string, CliFile>
  changed?: Record<string, string>
}

export interface CliRequest {
  args: string[]
  files?: Record<string, string>
  binaryFiles?: Record<string, string>
  stdin?: string
  timeoutSeconds?: number
  collect?: string[]
  workspace?: string
  writeBack?: boolean
}

export interface LocalSettings {
  addr: string
  autostart: boolean
  extraArgs: string[] | null
  config: string
  workspace: string
  watch: boolean
  logLevel: string
  restartOnFailure: boolean
}

export interface LocalState {
  status: 'stopped' | 'starting' | 'running' | 'exited' | 'failed'
  pid?: number
  startedAt?: string
  exitedAt?: string
  exitCode?: number
  error?: string
  command?: string[]
  restarts: number
  url: string
}

export interface LogLine {
  seq: number
  time: string
  stream: string
  text: string
}

export interface BundleMeta {
  name: string
  revision?: string
  source?: string
  size: number
  sha256: string
  etag: string
  signed: boolean
  publishedAt: string
  downloads: number
  notModified: number
  lastFetch?: string
  lastClient?: string
}

export interface BundleSummary {
  entries: { path: string; size: number; sha256: string; kind: string }[]
  manifest?: unknown
  signatures?: unknown
  size: number
  sha256: string
}

export interface Discovery {
  name: string
  decision: string
  config: unknown
  updatedAt?: string
}

export interface Decision {
  received_at: string
  remote: string
  decision_id?: string
  path?: string
  timestamp?: string
  event: Record<string, unknown>
}

export interface StatusReport {
  received_at: string
  remote: string
  instance_id: string
  report: Record<string, unknown>
}

export interface ReplEvent {
  seq: number
  stream: 'stdout' | 'stderr' | 'input' | 'system'
  text: string
}
