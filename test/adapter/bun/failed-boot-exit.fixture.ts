// A child process proves failed startup exits non-zero after rollback.
import { Elysia } from '../../../src'

let fail!: (error: Error) => void
const plugin = new Promise<Elysia>((_resolve, reject) => (fail = reject))

const app = new Elysia()
	.use(plugin as any)
	.get('/', () => 'ok')
	.listen(0, () => console.log('CALLBACK'))

// Bun binds before the plugin settles, so rollback must release this port.
const port = app.server!.port
console.log(`PORT=${port}`)

fail(new Error('db connect failed'))

// Let the process end naturally to test `process.exitCode`.
setTimeout(async () => {
	let released = false
	try {
		await fetch(`http://localhost:${port}/`, {
			signal: AbortSignal.timeout(100)
		})
	} catch {
		released = true
	}

	console.log(`SOCKET_RELEASED=${released}`)
	console.log(`SERVER=${app.server === undefined ? 'undefined' : 'live'}`)
}, 50)
