/**
 * Production-mode probe, executed as a subprocess by production-masking.test.ts
 * with NODE_ENV=production. Must NOT be imported by the main test run (that run
 * stays WITHOUT NODE_ENV). Emits a single JSON line on stdout.
 */

import { Elysia, t } from '../../src'

async function main() {
	// --- HTTP in production ---
	// Validate the BODY channel so it is apples-to-apples with the WS route,
	// which validates `body`.
	const http = new Elysia()
		.post(
			'/v',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body.n
		)
		.get('/e', () => {
			throw new Error('secret-detail')
		})
		// Non-Error throws: bare string and plain object. HTTP masks both to a
		// generic 500 in production (fallbackErrorResponse -> internalServerError).
		.get('/str', () => {
			throw 'secret-string'
		})
		.get('/obj', () => {
			throw { password: 'secret-object' }
		})

	let r = await http.handle(
		new Request('http://localhost/v', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ n: 'nope' })
		})
	)
	const httpValidation = await r.text()
	r = await http.handle(new Request('http://localhost/e'))
	const httpError = await r.text()
	r = await http.handle(new Request('http://localhost/str'))
	const httpThrowString = await r.text()
	r = await http.handle(new Request('http://localhost/obj'))
	const httpThrowObject = await r.text()

	// --- WS in production ---
	const app = new Elysia()
		.ws('/v', {
			body: t.Object({ n: t.Number() }),
			message(ws: any) {
				ws.send('ok')
			}
		})
		.ws('/e', {
			message() {
				throw new Error('secret-detail')
			}
		})
		.ws('/str', {
			message() {
				throw 'secret-string'
			}
		})
		.ws('/obj', {
			message() {
				throw { password: 'secret-object' }
			}
		})
		.listen(0)

	const server = app.server!

	// Resolve as soon as `expect` frames arrive; the timeout is only a failure
	// fallback so a broken transport surfaces as a wrong-length assertion.
	function probe(
		path: string,
		send: string,
		expect = 1,
		timeout = 3000
	): Promise<string[]> {
		return new Promise((resolve) => {
			const ws = new WebSocket(
				`ws://${server.hostname}:${server.port}${path}`
			)
			const frames: string[] = []
			let done = false
			const finish = () => {
				if (done) return
				done = true
				clearTimeout(timer)
				try {
					ws.close()
				} catch {}
				resolve(frames)
			}
			const timer = setTimeout(finish, timeout)
			ws.onopen = () => ws.send(send)
			ws.onmessage = (e) => {
				frames.push(String(e.data))
				if (frames.length >= expect) finish()
			}
			ws.onerror = () => {}
		})
	}

	const wsValidation = await probe('/v', JSON.stringify({ n: 'nope' }))
	const wsError = await probe('/e', 'x')
	const wsThrowString = await probe('/str', 'x')
	const wsThrowObject = await probe('/obj', 'x')

	app.stop()

	process.stdout.write(
		JSON.stringify({
			NODE_ENV: process.env.NODE_ENV,
			httpValidation,
			httpError,
			httpThrowString,
			httpThrowObject,
			wsValidation,
			wsError,
			wsThrowString,
			wsThrowObject
		})
	)
}

main().then(
	() => process.exit(0),
	(e) => {
		process.stderr.write(String(e?.stack ?? e))
		process.exit(1)
	}
)
