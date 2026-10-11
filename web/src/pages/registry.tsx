import type { ComponentType } from 'react'
import type { IconName } from '../components/icons'
import type { Manifest, Info } from '../api/types'
import { hasCommand, hasEndpoint, type EndpointKey } from '../lib/features'

import Dashboard from './Dashboard'
import Policies from './Policies'
import DataPage from './Data'
import Query from './Query'
import Compile from './Compile'
import Health from './Health'
import ConfigStatus from './ConfigStatus'
import Metrics from './Metrics'
import ApiConsole from './ApiConsole'
import WorkspacePage from './Workspace'
import Evaluate from './Evaluate'
import TestPage from './Test'
import Lint from './Lint'
import Analyze from './Analyze'
import Bench from './Bench'
import Exec from './Exec'
import Repl from './Repl'
import Builder from './Builder'
import Bundles from './Bundles'
import ControlPlane from './ControlPlane'
import LocalOpa from './LocalOpa'
import Builtins from './Builtins'
import Compatibility from './Compatibility'
import Connections from './Connections'
import About from './About'

export interface Gate {
  ok: boolean
  reason?: string
}

export interface PageDef {
  id: string
  path: string
  title: string
  description: string
  icon: IconName
  group: 'Server' | 'Develop' | 'Distribute' | 'Runtime' | 'Reference' | 'Settings'
  component: ComponentType
  gate?: (ctx: { cli: Manifest | null; server: Manifest | null; info: Info }) => Gate
}

const needEndpoint = (...keys: EndpointKey[]) => ({ server }: { server: Manifest | null }): Gate => {
  for (const k of keys) {
    if (hasEndpoint(server, k) !== false) return { ok: true }
  }
  return { ok: false, reason: `not in OPA ${server?.opa.version ?? ''}` }
}

const needCommand = (...cmds: string[]) => ({ cli, info }: { cli: Manifest | null; info: Info }): Gate => {
  if (!info.opa.available) return { ok: false, reason: 'no OPA binary' }
  for (const c of cmds) if (hasCommand(cli, c)) return { ok: true }
  return { ok: false, reason: `not in OPA ${cli?.opa.version ?? ''}` }
}

const needBinary = ({ info }: { info: Info }): Gate => (info.opa.available ? { ok: true } : { ok: false, reason: 'no OPA binary' })

export const pages: PageDef[] = [
  { id: 'dashboard', path: '/', title: 'Dashboard', description: 'Overview of the connected OPA server and this Studio instance', icon: 'dashboard', group: 'Server', component: Dashboard },
  { id: 'policies', path: '/policies', title: 'Policies', description: 'Policy API — list, view, create, update and delete Rego modules', icon: 'policy', group: 'Server', component: Policies, gate: needEndpoint('policies_list') },
  { id: 'data', path: '/data', title: 'Data', description: 'Data API — browse, read, query, create, patch and delete documents', icon: 'data', group: 'Server', component: DataPage, gate: needEndpoint('data_get', 'data_get_input', 'data_explain_full') },
  { id: 'query', path: '/query', title: 'Query', description: 'Query API — ad-hoc Rego queries and the default decision', icon: 'query', group: 'Server', component: Query, gate: needEndpoint('query_get') },
  { id: 'compile', path: '/compile', title: 'Compile', description: 'Compile API — partial evaluation and data filtering', icon: 'compile', group: 'Server', component: Compile, gate: needEndpoint('compile') },
  { id: 'health', path: '/health', title: 'Health', description: 'Health API — liveness, readiness, bundles and plugins', icon: 'health', group: 'Server', component: Health, gate: needEndpoint('health') },
  { id: 'config', path: '/config', title: 'Config & Status', description: 'Config API and Status API of the running server', icon: 'config', group: 'Server', component: ConfigStatus, gate: needEndpoint('config', 'status') },
  { id: 'metrics', path: '/metrics', title: 'Metrics', description: 'Prometheus metrics exposed at /metrics', icon: 'metrics', group: 'Server', component: Metrics, gate: needEndpoint('metrics') },
  { id: 'api', path: '/api-console', title: 'API Console', description: 'Send any HTTP request to the OPA REST API', icon: 'console', group: 'Server', component: ApiConsole },

  { id: 'workspace', path: '/workspace', title: 'Workspace', description: 'Edit policies, data, inputs and tests; deploy, import and export', icon: 'workspace', group: 'Develop', component: WorkspacePage },
  { id: 'evaluate', path: '/evaluate', title: 'Evaluate', description: 'opa eval — evaluate queries with explanations, metrics, profiling and coverage', icon: 'play', group: 'Develop', component: Evaluate, gate: needCommand('eval') },
  { id: 'test', path: '/test', title: 'Test', description: 'opa test — run policy tests with coverage and benchmarks', icon: 'test', group: 'Develop', component: TestPage, gate: needCommand('test') },
  { id: 'lint', path: '/lint', title: 'Check & Format', description: 'opa check and opa fmt — compile checks, strict mode and formatting', icon: 'format', group: 'Develop', component: Lint, gate: needCommand('check', 'fmt') },
  { id: 'analyze', path: '/analyze', title: 'Parse & Deps', description: 'opa parse and opa deps — AST and dependency analysis', icon: 'tree', group: 'Develop', component: Analyze, gate: needCommand('parse', 'deps') },
  { id: 'bench', path: '/bench', title: 'Benchmark', description: 'opa bench — benchmark query evaluation', icon: 'bench', group: 'Develop', component: Bench, gate: needCommand('bench') },
  { id: 'exec', path: '/exec', title: 'Exec', description: 'opa exec — evaluate decisions against input files like a sidecar', icon: 'exec', group: 'Develop', component: Exec, gate: needCommand('exec') },
  { id: 'repl', path: '/repl', title: 'REPL', description: 'opa run — the interactive Rego shell', icon: 'repl', group: 'Develop', component: Repl, gate: needBinary },
  { id: 'builder', path: '/builder', title: 'Command Builder', description: 'Run any OPA command with any flag supported by this version', icon: 'builder', group: 'Develop', component: Builder, gate: needBinary },

  { id: 'bundles', path: '/bundles', title: 'Bundles', description: 'opa build, opa inspect and opa sign — build, inspect, sign and verify bundles', icon: 'bundle', group: 'Distribute', component: Bundles },
  { id: 'control', path: '/control-plane', title: 'Control Plane', description: 'Serve bundles and discovery, collect decision logs and status reports', icon: 'cloud', group: 'Distribute', component: ControlPlane },

  { id: 'local', path: '/local-opa', title: 'Local OPA', description: 'Run and configure a managed OPA server', icon: 'server', group: 'Runtime', component: LocalOpa },
  { id: 'connections', path: '/connections', title: 'Connections', description: 'OPA servers Studio can talk to', icon: 'link', group: 'Runtime', component: Connections },

  { id: 'builtins', path: '/builtins', title: 'Built-ins', description: 'Built-in functions, keywords and features of this OPA version', icon: 'book', group: 'Reference', component: Builtins },
  { id: 'compat', path: '/compatibility', title: 'Compatibility', description: 'Measured capabilities of every OPA release', icon: 'layers', group: 'Reference', component: Compatibility },
  { id: 'about', path: '/about', title: 'About', description: 'Build information and settings', icon: 'info', group: 'Settings', component: About },
]

export const groups: PageDef['group'][] = ['Server', 'Develop', 'Distribute', 'Runtime', 'Reference', 'Settings']
