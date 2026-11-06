import { describe, it, expect } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { Elysia } from '../../src'

// Each process starts with the requested NODE_ENV before compiling the fixture.
const FIXTURE = new URL('./error-tail-mask.fixture.ts', import.meta.url)
	.pathname

interface Scenario {
	status: number
	body: string
	headers: Record<string, string>
}

const run = async (nodeEnv: string): Promise<Record<string, Scenario>> => {
	const env: Record<string, string> = {}
	for (const k in process.env)
		if (process.env[k] !== undefined) env[k] = process.env[k] as string
	env.NODE_ENV = nodeEnv

	const proc = Bun.spawn(['bun', 'run', FIXTURE], {
		env,
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	])
	await proc.exited

	if (proc.exitCode !== 0)
		throw new Error(
			`fixture exited ${proc.exitCode}:\n${stderr}\n${stdout}`
		)

	return JSON.parse(stdout.trim()) as Record<string, Scenario>
}

describe('compiled error tail', () => {
	it('masks only implicit 5xx messages in production', async () => {
		const r = await run('production')

		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toBe('Internal Server Error')
		expect(r.fiveHundred.body).not.toContain('hunter2')

		expect(r.fiveOhThree.status).toBe(503)
		expect(r.fiveOhThree.body).toBe('Internal Server Error')

		// `.response` opting out of the mask is what makes an *authored* body
		// publishable — a developer writing a string is saying "serve this"
		expect(r.explicitResponse.status).toBe(500)
		expect(r.explicitResponse.body).toBe('explicit body')

		// ...but the same property name is owned by the HTTP clients, so a
		// rethrown `AxiosError`/`got` failure must not turn the mask off and
		// publish the upstream's credentials and DSN. An authored body is a
		// string; a leaked client-library `.response` is an object
		expect(r.foreignClientResponse.status).toBe(502)
		expect(r.foreignClientResponse.body).toBe('Internal Server Error')
		expect(r.foreignClientResponse.body).not.toContain('hunter2')

		expect(r.fourHundred.status).toBe(400)
		expect(r.fourHundred.body).toContain('hunter2')
	})

	it('keeps error messages in development', async () => {
		const r = await run('development')

		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toContain('hunter2')

		// an Error's object `.response` is never served, in development too:
		// development is the default when NODE_ENV is unset, so the client's
		// upstream data would be public there. The message stays visible
		expect(r.foreignClientResponse.status).toBe(502)
		expect(r.foreignClientResponse.body).toBe(
			'secret: db password is hunter2'
		)
	})

	// An uncaught HTTP-client failure is an Error with `status` and an object
	// or `Response` `.response`: upstream body, upstream set-cookie, and the
	// outgoing Authorization header. It answers at its status with its message
	// (masked on a production 5xx), as 1.x did and the docs say, on every lane
	// an error reaches the fallback by: thrown, returned, from beforeHandle,
	// and past an onError that returns nothing
	for (const env of ['development', 'production'])
		it(`serves an HTTP client error's status and message, never its .response (${env})`, async () => {
			const r = await run(env)
			const cases = Object.entries(r).filter(([name]) =>
				name.startsWith('client.')
			)

			// 4 lanes x object/Response x 401/500
			expect(cases.length).toBe(16)

			for (const [name, { status, body, headers }] of cases) {
				const code = +name.split('.')[3]!

				expect({ name, status }).toEqual({ name, status: code })
				expect({ name, body }).toEqual({
					name,
					body:
						env === 'production' && code >= 500
							? 'Internal Server Error'
							: `Request failed with status code ${code}`
				})
				expect({ name, headers: JSON.stringify(headers) }).toEqual({
					name,
					headers: expect.not.stringContaining('UPSTREAM')
				})
			}

			// a status() box is not an Error: its object body is authored
			expect(r.statusObject.status).toBe(401)
			expect(JSON.parse(r.statusObject.body)).toEqual({ a: 1 })
		})

	it('matches the interpreted path when toResponse throws synchronously', async () => {
		const prod = await run('production')

		expect(prod.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(prod.syncThrowCompiled.body).toBe('Internal Server Error')
		expect(prod.syncThrowCompiled.status).toBe(503)
		expect(prod.syncThrowCompiled.status).toBe(
			prod.syncThrowInterpreted.status
		)
		expect(prod.syncThrowCompiled.body).toBe(prod.syncThrowInterpreted.body)

		const dev = await run('development')

		expect(dev.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(dev.syncThrowCompiled.body).toContain('original 503 message')
		expect(dev.syncThrowCompiled.status).toBe(503)
		expect(dev.syncThrowCompiled.status).toBe(
			dev.syncThrowInterpreted.status
		)
		expect(dev.syncThrowCompiled.body).toBe(dev.syncThrowInterpreted.body)
	})

	// An HTTP client running in another realm (a vm context, a worker's
	// structured clone) throws an Error that fails `instanceof Error`. Its
	// `.response` is still an upstream response and must not be served
	it('does not serve the response of an Error that fails instanceof', async () => {
		const upstream = {
			config: { headers: { authorization: 'Bearer UPSTREAM' } }
		}

		const foreign = runInNewContext(
			`Object.assign(new Error('foreign 401'), { status: 401 })`
		)
		foreign.response = upstream

		const stripped = Object.assign(new Error('stripped 401'), {
			status: 401,
			response: upstream
		})
		Object.setPrototypeOf(stripped, null)

		expect(foreign instanceof Error).toBe(false)

		const app = new Elysia()
			.get('/foreign', () => {
				throw foreign
			})
			.get('/stripped', () => {
				throw stripped
			})

		for (const [path, message] of [
			['/foreign', 'foreign 401'],
			['/stripped', 'stripped 401']
		]) {
			const response = await app.handle(path)

			expect(response.status).toBe(401)
			await expect(response.text()).resolves.toBe(message)
		}
	})
})
