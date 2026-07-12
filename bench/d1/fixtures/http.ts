import { resolve } from 'node:path'

import { injectHttp } from '../inject'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const parent = process.env.D1_PARENT === '1'
const shapes = [
	'plain-get',
	'dynamic-param',
	'validated-json',
	'coerced-query',
	'cookie',
	'mixed'
] as const
type Shape = (typeof shapes)[number]

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

function integerArgument(name: string, fallback: number) {
	const value = process.argv
		.find((argument) => argument.startsWith(`--${name}=`))
		?.slice(name.length + 3)
	const parsed = value === undefined ? fallback : Number(value)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function consume(response: Response) {
	if (!response.ok)
		throw new Error(`http fixture request failed: ${response.status}`)
	await response.arrayBuffer()
}

function request(base: string, shape: Shape, index: number) {
	switch (shape) {
		case 'plain-get':
			return fetch(`${base}/plain`)
		case 'dynamic-param':
			return fetch(`${base}/dynamic/${index % 100}`)
		case 'validated-json':
			return fetch(`${base}/json`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'elysia', age: index % 100 })
			})
		case 'coerced-query':
			return fetch(`${base}/query?page=${(index % 9) + 1}&limit=20`)
		case 'cookie':
			return fetch(`${base}/cookie`, {
				headers: { cookie: 'session=abc' }
			})
		case 'mixed':
			return fetch(`${base}/mixed/${index % 100}?page=2`, {
				headers: { cookie: 'session=abc' }
			})
	}
}

function makeHandleRequest(shape: Shape, index: number) {
	const base = 'http://localhost'
	switch (shape) {
		case 'plain-get':
			return new Request(`${base}/plain`)
		case 'dynamic-param':
			return new Request(`${base}/dynamic/${index % 100}`)
		case 'validated-json':
			return new Request(`${base}/json`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'elysia', age: index % 100 })
			})
		case 'coerced-query':
			return new Request(`${base}/query?page=${(index % 9) + 1}&limit=20`)
		case 'cookie':
			return new Request(`${base}/cookie`, {
				headers: { cookie: 'session=abc' }
			})
		case 'mixed':
			return new Request(`${base}/mixed/${index % 100}?page=2`, {
				headers: { cookie: 'session=abc' }
			})
	}
}

async function timedSamples(base: string, warmup: number, requests: number) {
	const samples = Object.fromEntries(
		shapes.map((shape) => [shape, [] as number[]])
	) as Record<Shape, number[]>
	for (const shape of shapes)
		for (let i = 0; i < warmup; i++)
			await consume(await request(base, shape, i))
	for (const shape of shapes) {
		for (let i = 0; i < requests; i++) {
			const started = Bun.nanoseconds()
			await consume(await request(base, shape, i))
			samples[shape]!.push(Bun.nanoseconds() - started)
		}
	}
	return samples
}

async function timedHandleSamples(app: any, warmup: number, requests: number) {
	const samples = Object.fromEntries(
		shapes.map((shape) => [shape, [] as number[]])
	) as Record<Shape, number[]>
	for (const shape of shapes)
		for (let i = 0; i < warmup; i++)
			await consume(await app.handle(makeHandleRequest(shape, i)))
	for (const shape of shapes) {
		for (let i = 0; i < requests; i++) {
			const started = Bun.nanoseconds()
			await consume(await app.handle(makeHandleRequest(shape, i)))
			samples[shape]!.push(Bun.nanoseconds() - started)
		}
	}
	return samples
}

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const { Elysia, t } = await import(repoRoot + '/src/index.ts')
	let app: any
	let stoppedResolve!: () => void
	const stopped = new Promise<void>((resolve_) => (stoppedResolve = resolve_))
	const stop = async () => {
		await app.stop()
		stoppedResolve()
	}
	app = new Elysia()
	if (process.env.D1_INJECT === 'http') app.request(injectHttp)
	app.get('/plain', () => 'ok')
		.get('/dynamic/:id', ({ params }: any) => params.id)
		.post(
			'/json',
			{ body: t.Object({ name: t.String(), age: t.Number() }) },
			({ body }: any) => body
		)
		.get(
			'/query',
			{ query: t.Object({ page: t.Number(), limit: t.Number() }) },
			({ query }: any) => query
		)
		.get(
			'/cookie',
			{ cookie: t.Object({ session: t.Optional(t.String()) }) },
			({ cookie }: any) => {
				const value = cookie.session.value ?? ''
				cookie.session.value = value + 'x'
				return value
			}
		)
		.get(
			'/mixed/:id',
			{
				query: t.Object({ page: t.Number() }),
				cookie: t.Object({ session: t.Optional(t.String()) })
			},
			({ params, query, cookie }: any) =>
				`${params.id}:${query.page}:${cookie.session.value ?? ''}`
		)
		.get('/__d1_done', () => {
			queueMicrotask(() => void stop())
			return 'done'
		})
	void app.fetch
	const socket = listen(app)
	const port = socket ? app.server!.port : 0
	const base = `http://127.0.0.1:${port}`
	console.error(`D1_READY ${port}${socket ? '' : ' handle'}`)
	const samples = socket
		? parent
			? {}
			: await timedSamples(base, warmup, requests)
		: await timedHandleSamples(app, warmup, requests)
	if (!parent) {
		if (socket) {
			await consume(await fetch(`${base}/__d1_done`))
			await stopped
		}
	}
	console.log(
		JSON.stringify({
			fixture: 'http',
			port,
			transport: socket ? 'socket' : 'handle-fallback',
			warmup,
			requests,
			samples
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
