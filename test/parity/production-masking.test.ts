// Run masking checks in a subprocess so NODE_ENV does not affect other tests.

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
})
