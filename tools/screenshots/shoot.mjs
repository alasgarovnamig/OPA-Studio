#!/usr/bin/env node
// Captures README screenshots of a running OPA Studio and doubles as an
// end-to-end smoke test: every page is opened, its main action is executed and
// console errors / failed Studio API calls are reported.
//
//   node shoot.mjs --base http://127.0.0.1:9080 --out ./out [--quality 62]
//
// Writes <out>/<NN-name>.webp and <out>/report.json.
import { chromium } from 'playwright'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const base = args.base ?? 'http://127.0.0.1:9080'
const out = args.out ?? './out'
const quality = Number(args.quality ?? 62)
const width = Number(args.width ?? 1440)
const height = Number(args.height ?? 900)

await fs.mkdir(out, { recursive: true })
const info = await (await fetch(`${base}/api/info`)).json()
const m = info.manifest
const cmds = m?.cli?.commands ?? {}
const has = (c) => !!cmds[c]
const flag = (c, f) => !!cmds[c]?.flags?.[f]
const ep = (k) => {
  const e = m?.server?.endpoints?.[k]
  if (!e) return false
  if (e.status === 0 || e.status === 405) return false
  if (e.status === 404) return (e.content_type ?? '').includes('json')
  return true
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' })
await context.addInitScript(() => {
  localStorage.setItem('studio.theme', 'light')
})
const page = await context.newPage()
const report = { version: m?.opa?.version, studio: info.studio, screens: [], consoleErrors: [], apiFailures: [] }
page.on('console', (msg) => {
  if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) report.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 300) })
})
page.on('pageerror', (e) => report.consoleErrors.push({ url: page.url(), text: String(e).slice(0, 300) }))
page.on('response', (r) => {
  const u = new URL(r.url())
  // Proxied OPA responses carry the upstream status; only Studio's own failures count.
  if (u.pathname.startsWith('/api/') && !u.pathname.includes('/proxy/') && r.status() >= 500) {
    report.apiFailures.push({ url: u.pathname + u.search, status: r.status() })
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle(extra = 400) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 3500 })
  } catch {
    /* streaming pages never go idle */
  }
  await sleep(extra)
}
async function go(p) {
  await page.goto(base + p)
  await page.waitForSelector('.topbar h1', { timeout: 20000 })
  await settle()
}
async function click(name, opts = {}) {
  const b = page.getByRole('button', { name, exact: opts.exact ?? true }).first()
  await b.click({ timeout: 10000 })
  await settle(opts.wait ?? 600)
}
async function shot(name, title, description) {
  const png = await page.screenshot({ type: 'png' })
  const file = `${name}.webp`
  await sharp(png).webp({ quality, effort: 6 }).toFile(path.join(out, file))
  report.screens.push({ file, title, description })
}

const screens = [
  {
    name: '01-dashboard', title: 'Dashboard', when: () => true,
    description: 'Connection health, server version, policy/data counts, runtime configuration and recent decisions at a glance.',
    run: async () => go('/'),
  },
  {
    name: '02-workspace', title: 'Workspace editor', when: () => true,
    description: 'Policies, data, inputs and tests of a workspace with Rego syntax highlighting, formatting, checks, deploy/pull, bundle import and export.',
    run: async () => {
      await go('/workspace')
      const f = page.locator('.list-item', { hasText: 'rbac.rego' }).first()
      if (await f.count()) await f.click()
      await settle()
    },
  },
  {
    name: '03-evaluate', title: 'Evaluate (opa eval)', when: () => has('eval'),
    description: 'Evaluates a query against the workspace with the input document; every `opa eval` flag of this release is available.',
    run: async () => {
      await go('/evaluate')
      await click('Evaluate', { wait: 1200 })
    },
  },
  {
    name: '04-test', title: 'Test (opa test)', when: () => has('test'),
    description: 'Runs the policy tests; results, coverage and benchmarks are rendered as tables.',
    run: async () => {
      await go('/test')
      await click('Run tests', { wait: 1500 })
    },
  },
  {
    name: '05-check-format', title: 'Check & Format', when: () => has('check') || has('fmt'),
    description: '`opa check` (including strict mode) and `opa fmt` with diff preview and write-back.',
    run: async () => {
      await go('/lint')
      if (has('check')) await click('Check', { wait: 1200 })
      else if (flag('fmt', 'diff')) await click('Show diff', { wait: 1200 })
    },
  },
  {
    name: '06-policies', title: 'Policy API', when: () => ep('policies_list'),
    description: 'Lists, reads, creates, updates and deletes the Rego modules stored on the server (`/v1/policies`).',
    run: async () => {
      await go('/policies')
      const f = page.locator('.list-item', { hasText: 'rbac.rego' }).first()
      if (await f.count()) await f.click()
      await settle()
    },
  },
  {
    name: '07-data', title: 'Data API', when: () => true,
    description: 'Browse the document tree, query decisions with input, explanations, metrics and provenance, and write documents (PUT / PATCH / DELETE).',
    run: async () => {
      await go('/data')
      const input = page.locator('input[placeholder="app/rbac/allow"]')
      await input.fill('app/rbac/allow')
      if (ep('data_get_input')) {
        const post = page.getByRole('button', { name: 'POST (input)' })
        if (await post.count()) await post.click()
      }
      const ex = page.locator('label:has-text("explain") select')
      if (await ex.count()) await ex.selectOption(ep('data_explain_full') ? 'full' : 'off').catch(() => {})
      await click('Send', { wait: 1000 })
    },
  },
  {
    name: '08-query', title: 'Query API', when: () => ep('query_get'),
    description: 'Ad-hoc Rego queries through `/v1/query` (GET and POST with input) and the default decision endpoint.',
    run: async () => {
      await go('/query')
      await click('Run', { wait: 1000 })
    },
  },
  {
    name: '09-compile', title: 'Compile API', when: () => ep('compile'),
    description: 'Partial evaluation with unknowns (`/v1/compile`); newer releases add data filtering to UCAST and SQL.',
    run: async () => {
      await go('/compile')
      await click('Compile', { wait: 1000 })
    },
  },
  {
    name: '10-health', title: 'Health API', when: () => ep('health'),
    description: 'Health checks including bundle and plugin readiness and custom `system.health` policies.',
    run: async () => {
      await go('/health')
      await click('Check', { wait: 1000 })
    },
  },
  {
    name: '11-config-status', title: 'Config & Status APIs', when: () => ep('config') || ep('status'),
    description: 'The active runtime configuration and status of plugins and bundles.',
    run: async () => go('/config'),
  },
  {
    name: '12-metrics', title: 'Prometheus metrics', when: () => ep('metrics'),
    description: 'Parsed `/metrics` exposition with metric families, types and samples.',
    run: async () => {
      await go('/metrics')
      const row = page.locator('tr.clickable').first()
      if (await row.count()) await row.click()
      await settle()
    },
  },
  {
    name: '13-bundles', title: 'Bundles', when: () => true,
    description: 'Build (`opa build`), inspect, sign and verify bundles; the native builder covers releases without `opa build`.',
    run: async () => {
      await go('/bundles')
      if (has('build')) await click('Build', { wait: 1500 })
    },
  },
  {
    name: '14-control-plane', title: 'Control plane: decision logs', when: () => true,
    description: 'Studio serves bundles and discovery and receives decision logs and status reports from OPA agents.',
    run: async () => {
      await go('/control-plane')
      await page.getByRole('tab', { name: 'Decision logs' }).click()
      await settle(1200)
      const row = page.locator('tr.clickable').first()
      if (await row.count()) await row.click()
      await settle()
    },
  },
  {
    name: '15-local-opa', title: 'Local OPA', when: () => info.settings.localOpa,
    description: 'Start, stop and configure the managed OPA server; live process logs.',
    run: async () => go('/local-opa'),
  },
  {
    name: '16-repl', title: 'REPL (opa run)', when: () => info.opa.available,
    description: 'The interactive Rego shell in the browser, with the workspace loaded.',
    run: async () => {
      await go('/repl')
      await click('Start session', { wait: 2500 })
      const line = page.locator('.page input.mono').last()
      const q = m?.preferred_dialect === 'datalog-noinput' ? 'data.app.rbac.allow' : 'data.app.rbac.allow with input as {"user": "alice", "action": "delete", "type": "dog"}'
      await line.fill(q)
      await line.press('Enter')
      await sleep(2500)
      await line.fill(m?.preferred_dialect === 'datalog-noinput' ? 'data.app.rbac' : 'data.app.rbac with input as {"user": "bob", "action": "update", "type": "dog"}')
      await line.press('Enter')
      await sleep(2000)
    },
  },
  {
    name: '17-command-builder', title: 'Command Builder', when: () => info.opa.available,
    description: 'Every command, subcommand and flag of this OPA release as a form — nothing the CLI can do is out of reach.',
    run: async () => {
      await go('/builder')
      const v = page.locator('.list-item', { hasText: 'version' }).first()
      if (await v.count()) await v.click()
      await click('Run', { wait: 1200 })
    },
  },
  {
    name: '18-api-console', title: 'API Console', when: () => true,
    description: 'Any HTTP request against the OPA REST API with presets for every documented operation.',
    run: async () => {
      await go('/api-console')
      await click('Send', { wait: 1000 })
    },
  },
  {
    name: '19-builtins', title: 'Built-in functions', when: () => !!m?.capabilities,
    description: 'All built-in functions, future keywords and features reported by `opa capabilities`.',
    run: async () => go('/builtins'),
  },
  {
    name: '20-compatibility', title: 'Compatibility matrix', when: () => true,
    description: 'Measured capabilities of every OPA release and the changes introduced by this one.',
    run: async () => {
      await go('/compatibility')
      await sleep(800)
      const sel = page.locator('tr.selected').first()
      if (await sel.count()) await sel.scrollIntoViewIfNeeded()
      const changes = page.getByRole('tab', { name: 'Changes' })
      if (await changes.count()) await changes.click()
      await settle()
    },
  },
]

const only = args.only ? new Set(args.only.split(',')) : null
for (const s of screens) {
  if (only && !only.has(s.name)) continue
  if (!s.when()) continue
  try {
    await s.run()
    await shot(s.name, s.title, s.description)
  } catch (e) {
    report.screens.push({ file: null, name: s.name, error: String(e).slice(0, 400) })
    try {
      await shot(s.name, s.title, s.description)
    } catch {
      /* ignore */
    }
  }
}
await browser.close()
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
const failed = report.screens.filter((s) => s.error).length
console.log(`${report.version}: ${report.screens.length - failed} screens, ${failed} failed actions, ${report.consoleErrors.length} console errors, ${report.apiFailures.length} api failures`)
