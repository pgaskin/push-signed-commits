import { strictEqual, ok, rejects } from 'node:assert'
import { describe, it, mock } from 'node:test'
import * as github from '../lib/core/github.ts'

describe('fetchRetry', () => {
  const url = new URL('https://api.github.test/fake')
  const init: RequestInit = { method: 'GET', headers: new Headers() }

  it('returns response and text on success', async () => {
    using _ = mockFetch(
      { status: 200, body: 'body' },
    )
    const [resp, text] = await github.fetchRetry(url, init)
    strictEqual(resp.status, 200)
    strictEqual(text, 'body')
  })

  for (const status of [400, 401, 403, 404, 410, 422, 451]) {
    it(`throws immediately for non-retryable status ${status}`, async () => {
      using ctx = mockFetch(
        { status, body: 'error' },
      )
      await rejects(github.fetchRetry(url, init, { maxRetries: 3 }), /non-retryable/)
      strictEqual(ctx.fetches.length, 1)
    })
  }

  it('retries retryable status and returns on success', async () => {
    using _ = mockFetch(
      { status: 500, body: 'error' },
      { status: 200, body: 'body' },
    )
    const [resp, text] = await github.fetchRetry(url, init, { maxRetries: 3 })
    strictEqual(resp.status, 200)
    strictEqual(text, 'body')
  })

  it('throws after maxRetries', async () => {
    using ctx = mockFetch(
      { status: 500, body: 'error' },
      { status: 500, body: 'error' },
      { status: 500, body: 'error' },
    )
    await rejects(github.fetchRetry(url, init, { maxRetries: 2 }), /reponse status 500/)
    strictEqual(ctx.fetches.length, 3) // 1 initial + 2 retries
  })

  it('throws after maxRetries 0', async () => {
    using _ = mockFetch(
      { status: 500, body: 'error' },
    )
    await rejects(github.fetchRetry(url, init, { maxRetries: 0 }), /reponse status 500/)
  })

  it('throws immediately when fetch throws', async () => {
    using ctx = mockFetch(
      new TypeError('fetch failed'),
    )
    await rejects(github.fetchRetry(url, init, { maxRetries: 3 }), /fetch failed/)
    strictEqual(ctx.fetches.length, 1)
  })

  it('retries secondary rate limit without Retry-After with 60s delay', async () => {
    using ctx = mockFetch(
      { status: 429, body: 'secondary rate limit' },
      { status: 200, body: 'ok' },
    )
    const [resp] = await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(resp.status, 200)
    strictEqual(ctx.timeouts[0], 60000)
  })

  it('retries secondary rate limit with Retry-After', async () => {
    using ctx = mockFetch(
      { status: 429, body: 'secondary rate limit', headers: { 'Retry-After': '5' } },
      { status: 200, body: 'ok' },
    )
    const [resp] = await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(resp.status, 200)
    strictEqual(ctx.timeouts[0], 5000)
  })

  it('retries secondary rate limit retries regardless of status code', async () => {
    using ctx = mockFetch(
      { status: 403, body: 'secondary rate limit' },
      { status: 200, body: 'ok' },
    )
    const [resp] = await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(resp.status, 200)
    strictEqual(ctx.timeouts[0], 60000)
  })

  it('uses numeric Retry-After', async () => {
    using fn = mockFetch(
      { status: 500, body: 'error', headers: { 'Retry-After': '5' } },
      { status: 200, body: 'ok' },
    )
    await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(fn.timeouts[0], 5000)
  })

  it('uses date Retry-After', async () => {
    using ctx = mockFetch(
      { status: 500, body: 'error', headers: { 'Retry-After': new Date(Date.now() + 3000).toUTCString() } },
      { status: 200, body: 'ok' },
    )
    await github.fetchRetry(url, init, { maxRetries: 1 })
    ok(ctx.timeouts[0] >= 3000 && ctx.timeouts[0] <= 5000, `expected ~4000ms delay, got ${ctx.timeouts[0]}ms`)
  })

  it('uses x-ratelimit-reset header', async () => {
    using ctx = mockFetch(
      { status: 500, body: 'error', headers: { 'x-ratelimit-reset': `${Math.floor((Date.now() + 5000) / 1000)}` } },
      { status: 200, body: 'ok' },
    )
    await github.fetchRetry(url, init, { maxRetries: 1 })
    ok(ctx.timeouts[0] >= 3000 && ctx.timeouts[0] <= 6000, `expected ~5000ms delay, got ${ctx.timeouts[0]}`)
  })

  it('prefers Retry-After over x-ratelimit-reset header', async () => {
    using ctx = mockFetch(
      { status: 500, body: 'error', headers: { 'Retry-After': '1', 'x-ratelimit-reset': `${Math.floor((Date.now() + 5000) / 1000)}` } },
      { status: 200, body: 'ok' },
    )
    await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(ctx.timeouts[0], 1000)
  })

  it('throws immediately on rate limit for non-retryable status 403', async () => {
    using ctx = mockFetch(
      { status: 403, body: 'rate limited', headers: { 'x-ratelimit-remaining': '0' } },
    )
    await rejects(github.fetchRetry(url, init, { maxRetries: 3 }), /hit rate limit/)
    strictEqual(ctx.fetches.length, 1)
  })

  it('retries on rate limit for retryable status 429', async () => {
    using _ = mockFetch(
      { status: 429, body: 'rate limited', headers: { 'x-ratelimit-remaining': '0' } },
      { status: 200, body: 'ok' },
    )
    const [resp] = await github.fetchRetry(url, init, { maxRetries: 1 })
    strictEqual(resp.status, 200)
  })

  it('uses exponential backoff when no retry headers are present', async () => {
    using ctx = mockFetch(
      { status: 500, body: 'error' },
      { status: 500, body: 'error' },
      { status: 200, body: 'ok' },
    )
    await github.fetchRetry(url, init, { maxRetries: 3 })
    strictEqual(ctx.timeouts[0], 1000)
    strictEqual(ctx.timeouts[1], 4000)
  })
})

function mockFetch(...specs: (Error | { status: number; body: string; headers?: Record<string, string> })[]) {
  const fetch = globalThis.fetch
  if (typeof (fetch as any)['mock'] !== 'undefined') {
    throw new Error('fetch is already mocked')
  }

  const setTimeout = globalThis.setTimeout
  if (typeof (setTimeout as any)['mock'] !== 'undefined') {
    throw new Error('setTimeout is already mocked')
  }

  const mockFetch = mock.fn(async () => {
    const s = specs.shift()
    if (!s) throw new Error('unexpected extra fetch call')
    if (s instanceof Error) throw s
    return new Response(s.body, { status: s.status, headers: s.headers })
  })

  const timeouts: number[] = []
  const mockSetTimeout = mock.fn((callback: () => void, delay = 0) => {
    timeouts.push(delay)
    callback()
    return setTimeout(() => {}, 0)
  })

  globalThis.fetch = mockFetch as unknown as typeof fetch
  globalThis.setTimeout = mockSetTimeout as unknown as typeof setTimeout

  return {
    get timeouts() {
      return timeouts
    },
    get fetches() {
      return mockFetch.mock.calls
    },
    [Symbol.dispose]() {
      globalThis.fetch = fetch
      globalThis.setTimeout = setTimeout
    },
  }
}
