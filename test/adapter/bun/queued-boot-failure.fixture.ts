import { Elysia } from '../../../src'

const setup = Promise.withResolvers<void>()
const mode = process.argv[2] ?? 'callback-stop'
const development = process.argv[3] === 'development'
const failure = new Error('private-startup-failure-marker')
const reported = Promise.withResolvers<void>()
const report = console.error
console.error = (...args) => {
	report(...args)
	if (args[0] === '[Elysia] listen() failed:') reported.resolve()
}
const stopModes: boolean[] = []
let cleaned = false
let handlerCalls = 0
let stopping: Promise<void> | undefined
let app: Elysia

app = new Elysia()
	.setup(() => setup.promise.then(() => {}))
	.cleanup(() => {
		cleaned = true
	})
	.get('/', () => {
		handlerCalls++
		return 'ready'
	})
	.listen(
		{ port: 0, hostname: '127.0.0.1', development, idleTimeout: 0 },
		() => {
			if (mode === 'callback-stop' || mode === 'callback-force')
				stopping = app
					.stop(mode === 'callback-force')
					?.catch((error) => {
						if (error !== failure) throw error
					})
			if (mode.startsWith('callback')) throw failure
		}
	)

const server = app.server!
const stop = server.stop.bind(server)
server.stop = (close) => {
	stopModes.push(close === true)
	if (mode.endsWith('stop-throws') && stopModes.length === 1)
		throw new Error('native-stop-failure-marker')
	return stop(close)
}
const response = fetch(`http://127.0.0.1:${server.port}/`).then(
	async (response) => ({
		status: response.status,
		body: await response.text(),
		connection: response.headers.get('connection')
	}),
	() => 'connection closed'
)
// A fetch callback can run before Bun accounts for the native request.
// Wait for native registration so the child detects shutdown/fetch cycles.
while (!server.pendingRequests) await Bun.sleep(0)
if (mode === 'cancel') stopping = app.stop()
if (mode.startsWith('setup')) setup.reject(failure)
else setup.resolve()
const result = await response
if (mode === 'success') stopping = app.stop()
if (mode !== 'success' && mode !== 'cancel') await reported.promise
await stopping
if (mode.endsWith('stop-throws')) await app.stop()?.catch(() => {})
console.log(
	JSON.stringify({
		result,
		cleaned,
		handlerCalls,
		stopModes,
		serverCleared: app.server === undefined
	})
)
