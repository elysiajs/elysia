/**
 * Production error-masking PARITY across transports.
 *
 * Finding: maintainability-arch-2 + dx-greenfield-5.
 *
 * HTTP masks error/validation detail in production (drops detail/found/errors,
 * generic 500 body). This suite runs a subprocess with NODE_ENV=production
 * (the main test run itself must stay WITHOUT NODE_ENV, so masking is probed
 * out-of-process) and compares HTTP vs WS.
 *
 * Where they agree (validation masking) we assert a shared invariant. Where
 * they diverge (generic-error masking) we PIN current behavior with the
 * finding id.
 */

import { describe, it, expect } from 'bun:test'

const PROBE = new URL('./_prod-probe.ts', import.meta.url).pathname

async function runProbe(): Promise<{
	NODE_ENV: string
	httpValidation: string
	httpError: string
	httpThrowString: string
	httpThrowObject: string
	wsValidation: string[]
	wsError: string[]
	wsThrowString: string[]
	wsThrowObject: string[]
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

describe('production masking parity (subprocess NODE_ENV=production)', () => {
	it('validation detail is masked identically on HTTP and WS in production', async () => {
		const { NODE_ENV, httpValidation, wsValidation } = await runProbe()
		expect(NODE_ENV).toBe('production')

		const http = JSON.parse(httpValidation)
		expect(wsValidation).toHaveLength(1)
		const ws = JSON.parse(wsValidation[0])

		// Shared invariant: both are structured problem+json with the concrete
		// detail/found/errors masked away in production.
		for (const body of [http, ws]) {
			expect(body).toMatchObject({
				type: 'validation',
				title: 'Validation Error',
				status: 422
			})
			expect(body.detail).toBeUndefined()
			expect(body.found).toBeUndefined()
			expect(body.errors).toBeUndefined()
		}

		// And they agree on on/property.
		expect({ on: ws.on, property: ws.property }).toEqual({
			on: http.on,
			property: http.property
		})
	})

	// ------------------------------------------------------------------
	// PARITY (was PIN dx-greenfield-5): a generic thrown Error's message is
	// MASKED on BOTH transports in production, AND the WS frame is now the exact
	// HTTP problem+json body (WS errors -> problem+json, maintainer 2026-07-06).
	// wsErrorFrame() reuses internalServerErrorBody(), whose prod branch drops
	// `detail`/`name`, so the raw message never reaches the wire and the two
	// bodies are byte-identical.
	// ------------------------------------------------------------------
	it('generic Error message is masked identically on HTTP and WS in production', async () => {
		const { httpError, wsError } = await runProbe()

		// HTTP: masked — no 'secret-detail' anywhere in the body.
		expect(httpError).not.toContain('secret-detail')
		const http = JSON.parse(httpError)
		expect(http).toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(http.detail).toBeUndefined()

		// WS: masked too — the raw error.message must NOT reach the wire in prod,
		// and the frame equals the HTTP problem+json body exactly.
		expect(wsError).toHaveLength(1)
		expect(wsError[0]).not.toContain('secret-detail')
		expect(wsError[0]).toBe(httpError)
	})

	// ------------------------------------------------------------------
	// PARITY (Codex defect: non-Error throws leaked verbatim on WS). A bare
	// `throw 'secret-string'` or `throw {password}` is fully masked on BOTH
	// transports in production AND emits the exact same problem+json body (WS
	// errors -> problem+json, maintainer 2026-07-06). HTTP falls through
	// fallbackErrorResponse to the generic internalServerErrorResponse (the thrown
	// value's content never reaches the wire). wsErrorFrame's non-Error arm
	// previously emitted `error + ''` (→ "secret-string" / "[object Object]") over
	// the wire; it now reuses internalServerErrorBody so the frame equals the HTTP
	// body byte-for-byte. WHY this matters: a WS handler that throws a raw string
	// or object (a common mistake, or a leaked secret) must not broadcast that
	// value to clients in production.
	// ------------------------------------------------------------------
	it('non-Error throw (string) is masked identically on HTTP and WS in production', async () => {
		const { httpThrowString, wsThrowString } = await runProbe()

		// HTTP: the thrown string never appears; generic 500 body.
		expect(httpThrowString).not.toContain('secret-string')
		expect(JSON.parse(httpThrowString)).toMatchObject({
			type: 'internal-server-error',
			status: 500,
			title: 'Internal Server Error'
		})

		// WS: same — the raw thrown string must NOT reach the wire, and the frame
		// equals the HTTP problem+json body exactly.
		expect(wsThrowString).toHaveLength(1)
		expect(wsThrowString[0]).not.toContain('secret-string')
		expect(wsThrowString[0]).toBe(httpThrowString)
	})

	it('non-Error throw (plain object) is masked identically on HTTP and WS in production', async () => {
		const { httpThrowObject, wsThrowObject } = await runProbe()

		// HTTP: the thrown object's contents never appear; generic 500 body.
		expect(httpThrowObject).not.toContain('secret-object')
		expect(JSON.parse(httpThrowObject)).toMatchObject({
			type: 'internal-server-error',
			status: 500,
			title: 'Internal Server Error'
		})

		// WS: same — no object content on the wire, and no "[object Object]" leak;
		// the frame equals the HTTP problem+json body exactly.
		expect(wsThrowObject).toHaveLength(1)
		expect(wsThrowObject[0]).not.toContain('secret-object')
		expect(wsThrowObject[0]).not.toContain('[object Object]')
		expect(wsThrowObject[0]).toBe(httpThrowObject)
	})
})
