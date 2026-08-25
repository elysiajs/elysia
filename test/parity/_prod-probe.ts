// Production subprocess entry point; do not import it into the main test run.
// Prints one JSON payload for its caller.

import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

async function main() {
	const http = new Elysia()
		.post('/v', { body: t.Object({ n: t.Number() }) }, ({ body }) => body.n)
		.get('/e', () => {
			throw new Error('secret-detail')
		})
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

	const app = new Elysia()
		.use(websocket()).ws('/v', {
			body: t.Object({ n: t.Number() }),
			message(ws: any) {
				ws.send('ok')
			}
		})
		.use(websocket()).ws('/e', {
			message() {
				throw new Error('secret-detail')
			}
		})
		.use(websocket()).ws('/str', {
			message() {
				throw 'secret-string'
			}
		})
		.use(websocket()).ws('/obj', {
			message() {
				throw { password: 'secret-object' }
			}
		})
		.listen(0)

	const server = app.server!

	// Resolve on the expected frame count; the timeout prevents a hung probe.
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
