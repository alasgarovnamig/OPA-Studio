import { describe, expect, it } from 'vitest'
import { commandLine, shellQuote, shellSplit } from './args'
import { parsePrometheus } from './prometheus'
import { compareVersions, endpointAvailable, flagChoices } from './features'
import type { Manifest } from '../api/types'

describe('shellSplit', () => {
  it('splits quoted arguments', () => {
    expect(shellSplit(`eval -d . 'data.x == "a b"' --format=json`)).toEqual(['eval', '-d', '.', 'data.x == "a b"', '--format=json'])
    expect(shellSplit(`a "b \\"c\\"" ''`)).toEqual(['a', 'b "c"', ''])
    expect(shellSplit('  ')).toEqual([])
  })
  it('round-trips through shellQuote', () => {
    const args = ['eval', 'data.x[_] == "y"', "it's", '']
    expect(shellSplit(args.map(shellQuote).join(' '))).toEqual(args)
    expect(commandLine(['version'])).toBe('opa version')
  })
})

describe('parsePrometheus', () => {
  it('groups samples by family', () => {
    const m = parsePrometheus(`# HELP http_request_duration_seconds A histogram.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{code="200",le="0.1"} 3
http_request_duration_seconds_sum{code="200"} 0.2
http_request_duration_seconds_count{code="200"} 3
# TYPE go_goroutines gauge
go_goroutines 12
`)
    expect(m.map((x) => x.name)).toEqual(['go_goroutines', 'http_request_duration_seconds'])
    const h = m[1]
    expect(h.type).toBe('histogram')
    expect(h.help).toBe('A histogram.')
    expect(h.samples).toHaveLength(3)
    expect(h.samples[0].labels).toEqual({ code: '200', le: '0.1' })
  })
})

describe('features', () => {
  it('compares versions semantically', () => {
    expect(compareVersions('v0.9.0', 'v0.10.0')).toBe(-1)
    expect(compareVersions('v0.19.0-rc1', 'v0.19.0')).toBe(-1)
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0)
  })
  it('treats JSON 404 as an existing route', () => {
    expect(endpointAvailable({ method: 'GET', path: '/', status: 404, content_type: 'application/json' })).toBe(true)
    expect(endpointAvailable({ method: 'GET', path: '/', status: 404, content_type: 'text/plain' })).toBe(false)
    expect(endpointAvailable(undefined)).toBeUndefined()
  })
  it('extracts flag choices', () => {
    const m = {
      cli: {
        commands: {
          eval: {
            description: '',
            flags: {
              format: { type: '{json,values,bindings}', description: 'set output format' },
              explain: { type: 'string', description: 'enable query explanations (off, full, notes, fails, debug)' },
            },
          },
        },
      },
    } as unknown as Manifest
    expect(flagChoices(m, 'eval', 'format')).toEqual(['json', 'values', 'bindings'])
    expect(flagChoices(m, 'eval', 'explain')).toEqual(['off', 'full', 'notes', 'fails', 'debug'])
  })
})
