// Run masking checks in a subprocess so NODE_ENV does not affect other tests.

import { describe, it, expect } from 'bun:test'

const PROBE = new URL('./_http-error-prod-probe.ts', import.meta.url).pathname

async function runProbe(): Promise<{
	NODE_ENV: string
	owned: { status: number; body: string }
	foreign: { status: number; body: string }
	namedForeign: { status: number; body: string }
	namedOwned: { status: number; body: string }
	nan: { status: number; body: string }
	zero: { status: number; body: string }
}> {
	const proc = Bun.spawn(['bun', PROBE], {
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])

	if (code !== 0)
		throw new Error(`prod probe exited ${code}\nstderr:\n${err}`)

	return JSON.parse(out.trim())
}

describe('self-describing error masking in production', () => {
	it('serves an owned HTTPError body even on 5xx', async () => {
		const { NODE_ENV, owned } = await runProbe()

		expect(NODE_ENV).toBe('production')
		expect(owned.status).toBe(500)
		expect(JSON.parse(owned.body)).toEqual({
			type: 'OWNED',
			title: 'Internal Server Error',
			detail: 'owned-detail',
			status: 500
		})
	})

	// undici's ResponseStatusCodeError carries `status` and `body`, serving it
	// would leak an upstream response the app never opted into exposing
	it('masks a foreign 5xx error that only looks self-describing', async () => {
		const { foreign } = await runProbe()

		expect(foreign.status).toBe(502)
		expect(foreign.body).not.toContain('upstream-secret')
		expect(foreign.body).toBe('Internal Server Error')
	})

	// `'Bad Gateway' >= 500` is false as a string, the mask has to compare
	// the resolved number or a named 5xx would walk straight through it
	it('masks a 5xx written as a status name', async () => {
		const { namedForeign, namedOwned } = await runProbe()

		expect(namedForeign.status).toBe(502)
		expect(namedForeign.body).not.toContain('upstream-secret')
		expect(namedForeign.body).toBe('Internal Server Error')

		// Owned, so problem-shaped, but the masked string is what reaches
		// `detail` — the message never gets there
		expect(namedOwned.status).toBe(500)
		expect(namedOwned.body).not.toContain('leaky-detail')
		expect(JSON.parse(namedOwned.body)).toEqual({
			type: 'NAMED_OWNED',
			title: 'Internal Server Error',
			detail: 'Internal Server Error',
			status: 500
		})
	})

	// `NaN >= 500` is false, a malformed status must not buy a body past the
	// mask that a well-formed 5xx would never get
	it('masks a foreign error carrying a malformed status', async () => {
		const { nan, zero } = await runProbe()

		expect(nan.status).toBe(500)
		expect(nan.body).not.toContain('upstream-secret')

		expect(zero.status).toBe(500)
		expect(zero.body).not.toContain('upstream-secret')
	})
})
