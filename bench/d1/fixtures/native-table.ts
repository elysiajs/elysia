import { resolve } from 'node:path'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

function listen(app: any) {
	try {
		app.listen(0)
		return true
	} catch {
		try {
			app.listen(40_000 + (process.pid % 10_000))
			return true
		} catch {
			return false
		}
	}
}

function routeCount() {
	const argument = process.argv.find((value) => value.startsWith('--routes='))
	const value = argument ? Number(argument.slice(9)) : 1_000
	return Number.isInteger(value) && value > 0 ? value : 1_000
}

function countReady(ready: Record<string, Record<string, Response>>) {
	return Object.values(ready).reduce(
		(count, methods) => count + Object.keys(methods).length,
		0
	)
}

async function main() {
	const routes = routeCount()
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const { collectStaticRoutes } = await import(
		repoRoot + '/src/adapter/bun/index.ts'
	)
	const app = new Elysia({ nativeStaticResponse: true, strictPath: true })
	for (let i = 0; i < routes; i++) app.get(`/d1/native/${i}`, `native-${i}`)
	void app.fetch
	const collected = collectStaticRoutes(app as any)
	const promotedRoutes = collected
		? countReady(collected[0] as Record<string, Record<string, Response>>)
		: 0
	const socket = listen(app)
	if (socket) await new Promise((resolve_) => setTimeout(resolve_, 0))
	const url = `http://127.0.0.1:${socket ? app.server!.port : 0}/d1/native/0`
	const served = socket
		? await fetch(url)
		: await app.handle(new Request(url))
	const direct = await app.handle(new Request(url))
	const servedBody = new Uint8Array(await served.arrayBuffer())
	const directBody = new Uint8Array(await direct.arrayBuffer())
	const parity =
		served.status === direct.status &&
		servedBody.length === directBody.length &&
		servedBody.every((byte, index) => byte === directBody[index])
	if (socket) await app.stop()
	if (!parity) throw new Error('native table parity spot-check failed')
	console.log(
		JSON.stringify({
			fixture: 'native-table',
			routes,
			transport: socket ? 'socket' : 'handle-fallback',
			promotedRoutes,
			parity,
			routeSizeOrder: [routes]
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
