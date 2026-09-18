// Run masking checks in a subprocess so NODE_ENV does not affect other tests.

import { describe, it, expect } from 'bun:test'

const PROBE = new URL('./_prod-probe.ts', import.meta.url).pathname

async function runProbe(nodeEnv = 'production'): Promise<{
	NODE_ENV: string
	httpValidation: string
	httpError: string
	httpThrowString: string
	httpThrowObject: string
	httpElysiaError: string
	httpElysiaError4xx: string
	httpExplicitResponse: string
	wsValidation: string[]
	wsError: string[]
	wsThrowString: string[]
	wsThrowObject: string[]
	wsElysiaError: string[]
	wsElysiaError4xx: string[]
	wsReturnedElysiaError: string[]
}> {
	const proc = Bun.spawn(['bun', PROBE], {
		env: { ...process.env, NODE_ENV: nodeEnv },
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

describe('production error masking across HTTP and WebSocket', () => {
	it('validation detail is masked identically on HTTP and WS in production', async () => {
		const { NODE_ENV, httpValidation, wsValidation } = await runProbe()
		expect(NODE_ENV).toBe('production')

		const http = JSON.parse(httpValidation)
		expect(wsValidation).toHaveLength(1)
		const ws = JSON.parse(wsValidation[0])

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

		expect({ on: ws.on, property: ws.property }).toEqual({
			on: http.on,
			property: http.property
		})
	})

	it('generic Error message is masked identically on HTTP and WS in production', async () => {
		const { httpError, wsError } = await runProbe()

		expect(httpError).not.toContain('secret-detail')
		const http = JSON.parse(httpError)
		expect(http).toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(http.detail).toBeUndefined()

		expect(wsError).toHaveLength(1)
		expect(wsError[0]).not.toContain('secret-detail')
		expect(wsError[0]).toBe(httpError)
	})

	it('masks thrown strings identically on HTTP and WS in production', async () => {
		const { httpThrowString, wsThrowString } = await runProbe()

		expect(httpThrowString).not.toContain('secret-string')
		expect(JSON.parse(httpThrowString)).toMatchObject({
			type: 'internal-server-error',
			status: 500,
			title: 'Internal Server Error'
		})

		expect(wsThrowString).toHaveLength(1)
		expect(wsThrowString[0]).not.toContain('secret-string')
		expect(wsThrowString[0]).toBe(httpThrowString)
	})

	it('masks thrown objects identically on HTTP and WS in production', async () => {
		const { httpThrowObject, wsThrowObject } = await runProbe()

		expect(httpThrowObject).not.toContain('secret-object')
		expect(JSON.parse(httpThrowObject)).toMatchObject({
			type: 'internal-server-error',
			status: 500,
			title: 'Internal Server Error'
		})

		expect(wsThrowObject).toHaveLength(1)
		expect(wsThrowObject[0]).not.toContain('secret-object')
		expect(wsThrowObject[0]).not.toContain('[object Object]')
		expect(wsThrowObject[0]).toBe(httpThrowObject)
	})

	// An explicit 5xx `response` is published in production by contract, so
	// `InvalidCookie.secret()` was handing clients our own `cookie.secrets`
	// setup advice on a 500. The advice is ours, not the operator's, so the
	// class serves the status text in production and keeps the advice on
	// `message` for the log
	it('masks the cookie.secrets advice identically on HTTP and WS in production', async () => {
		const { httpElysiaError, wsElysiaError } = await runProbe()

		for (const body of [httpElysiaError, ...wsElysiaError]) {
			expect(body).not.toContain('cookie.secrets')
			expect(body).not.toContain('anyone can forge')
		}

		const http = JSON.parse(httpElysiaError)
		expect(http.detail).toBeUndefined()
		// masking the advice must not blank the error's identity — a client
		// still gets a token to dispatch on
		expect(http).toMatchObject({
			type: 'invalid-cookie',
			code: 'invalid-cookie',
			status: 500,
			title: 'Internal Server Error'
		})

		expect(wsElysiaError).toHaveLength(1)
		expect(wsElysiaError[0]).toBe(httpElysiaError)
	})

	// The mask lives in `response` rather than in the problem serializer
	// because a WS handler may *return* the error, which is framed as plain
	// data and never reaches the error lane at all
	it('masks the advice on a returned, never-thrown ElysiaError in production', async () => {
		const { wsReturnedElysiaError } = await runProbe()

		expect(wsReturnedElysiaError).toHaveLength(1)
		expect(wsReturnedElysiaError[0]).not.toContain('cookie.secrets')
		expect(wsReturnedElysiaError[0]).not.toContain('anyone can forge')
		expect(JSON.parse(wsReturnedElysiaError[0])).toMatchObject({
			status: 500,
			response: 'Internal Server Error'
		})
	})

	// Scoped to the advice, not to 5xx detail at large: an explicitly authored
	// `response` on a 500 stays published, which is the documented contract
	// ("any ElysiaError with status >= 500 *without explicit response*")
	it('still publishes an explicitly authored 5xx response in production', async () => {
		const { httpExplicitResponse } = await runProbe()

		expect(JSON.parse(httpExplicitResponse)).toMatchObject({
			code: 'internal-server-error',
			status: 500,
			detail: 'explicit-operator-body'
		})
	})

	// A 4xx is the client's fault and its detail is what tells them how to fix
	// the request, so the sibling cookie error is untouched
	it('keeps a built-in ElysiaError 4xx detail in production', async () => {
		const { httpElysiaError4xx, wsElysiaError4xx } = await runProbe()

		expect(httpElysiaError4xx).toContain('invalid cookie signature')
		expect(JSON.parse(httpElysiaError4xx)).toMatchObject({
			code: 'invalid-cookie',
			status: 400,
			detail: '"session" has invalid cookie signature'
		})

		expect(wsElysiaError4xx).toHaveLength(1)
		expect(wsElysiaError4xx[0]).toBe(httpElysiaError4xx)
	})

	it('keeps the cookie.secrets advice during development', async () => {
		const {
			NODE_ENV,
			httpElysiaError,
			wsElysiaError
		} = await runProbe('development')
		expect(NODE_ENV).toBe('development')

		expect(httpElysiaError).toContain('cookie.secrets')

		expect(wsElysiaError).toHaveLength(1)
		expect(wsElysiaError[0]).toBe(httpElysiaError)
	})
})
