// Hook order for routes a plugin brings in through `.use()`.
//
// Rule, taken from the 1-level `.use(R)` shape and required of every shape:
// for each hook type, a plugin route runs
//
//   [root hooks registered before .use,
//    each intermediate plugin's hooks registered before its own .use
//    (outermost first),
//    the plugin's own hooks,
//    root hooks registered after .use]
//
// An app-wide observer registered before `.use()` (Sentry-style `.onError(fn)`)
// must see every error, including ones a nested plugin handles. Nesting
// depth, an intermediate plugin that only has `.derive`, a guard or a group
// must not move root hooks behind the plugin's own.
//
// Local hooks a plugin registers AFTER its route don't apply to that route,
// except `error`, which still reaches it.
//
// `request` is fetch-level rather than composed per route, but follows the
// same order, so it is checked alongside.

import { describe, expect, it } from 'bun:test'
import { Elysia, status } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

class MyError extends Error {
	readonly kind = 'my-error'
}
class ChildError extends MyError {
	readonly child = true
}
class OtherError extends Error {
	readonly kind = 'other-error'
}

type Log = string[]

interface Served {
	status: number
	body: string
	log: Log
}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

// Send each request on a fresh lane app, recording what `log` collected for it
const serve = async (
	lane: LaneFactory,
	define: Define,
	requests: Request[],
	log: Log = []
) => {
	const instance = await lane.make(define)
	const served: Served[] = []

	try {
		for (const request of requests) {
			log.length = 0
			const response = await instance.handle(request)
			const body = await response.text()
			// afterResponse runs after the response is handed back
			await Bun.sleep(10)
			served.push({ status: response.status, body, log: log.slice() })
		}
	} finally {
		await instance.dispose()
	}

	return served
}

const post = (path: string) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ a: 1 })
	})

const get = (path: string) => new Request(`http://localhost${path}`)

// Register one logging hook of every type, tagged
const hooks = (app: any, tag: string, log: Log) =>
	app
		.onRequest(() => {
			log.push(`request:${tag}`)
		})
		.onParse(() => {
			log.push(`parse:${tag}`)
		})
		.onTransform(() => {
			log.push(`transform:${tag}`)
		})
		.derive(() => {
			log.push(`derive:${tag}`)
			return {}
		})
		.onBeforeHandle(() => {
			log.push(`beforeHandle:${tag}`)
		})
		.onAfterHandle(() => {
			log.push(`afterHandle:${tag}`)
		})
		.mapResponse(() => {
			log.push(`mapResponse:${tag}`)
		})
		.onAfterResponse(() => {
			log.push(`afterResponse:${tag}`)
		})
		.onError(() => {
			log.push(`error:${tag}`)
		})

const byType = (log: Log) => {
	const rows: Record<string, string[]> = {}

	for (const entry of log) {
		const at = entry.indexOf(':')
		;(rows[entry.slice(0, at)] ??= []).push(entry.slice(at + 1))
	}

	return rows
}

// Types that run for a successful POST, and for a returned error
const okTypes = [
	'request',
	'parse',
	'transform',
	'derive',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse'
]
const errorTypes = [
	'request',
	'transform',
	'derive',
	'beforeHandle',
	'error',
	'afterResponse'
]

const expectOrder = (
	log: Log,
	types: string[],
	order: (type: string) => string[]
) => {
	const rows = byType(log)

	expect(Object.keys(rows).sort()).toEqual([...types].sort())
	for (const type of types)
		expect({ type, order: rows[type] }).toEqual({
			type,
			order: order(type)
		})
}

interface Shape {
	name: string
	prefix: string
	mount(root: any, plugin: any, log: Log): any
	// Intermediate tags expected between the root's hooks and the plugin's
	between(type: string): string[]
}

const shapes: Shape[] = [
	{
		name: '1 level: .use(R)',
		prefix: '',
		mount: (root, plugin) => root.use(plugin),
		between: () => []
	},
	{
		name: '2 levels: .use(P.use(R)), P has hooks',
		prefix: '',
		mount: (root, plugin, log) =>
			root.use(hooks(new Elysia(), 'P', log).use(plugin)),
		between: () => ['P']
	},
	{
		name: '2 levels: .use(P.use(R)), P has only .derive',
		prefix: '',
		mount: (root, plugin, log) =>
			root.use(
				new Elysia()
					.derive(() => {
						log.push('derive:P')
						return {}
					})
					.use(plugin)
			),
		between: (type) => (type === 'derive' ? ['P'] : [])
	},
	{
		name: '2 levels: .use(P.use(R)), P has no hooks',
		prefix: '',
		mount: (root, plugin) => root.use(new Elysia().use(plugin)),
		between: () => []
	},
	{
		name: '3 levels: .use(Q.use(P.use(R)))',
		prefix: '',
		mount: (root, plugin, log) =>
			root.use(
				hooks(new Elysia(), 'Q', log).use(
					hooks(new Elysia(), 'P', log).use(plugin)
				)
			),
		between: () => ['Q', 'P']
	},
	{
		name: '.guard({}, a => a.use(R))',
		prefix: '',
		mount: (root, plugin) => root.guard({}, (app: any) => app.use(plugin)),
		between: () => []
	},
	{
		name: ".group('/g', a => a.use(R))",
		prefix: '/g',
		mount: (root, plugin) =>
			root.group('/g', (app: any) => app.use(plugin)),
		between: () => []
	}
]

for (const lane of lanes)
	describe(`nested hook order (${lane.id})`, () => {
		for (const shape of shapes) {
			it(`${shape.name}: every hook type in order`, async () => {
				const log: Log = []
				const [ok, error] = await serve(
					lane,
					(base) =>
						hooks(
							shape.mount(
								hooks(base, 'root-before', log),
								hooks(new Elysia(), 'R', log)
									.post('/', () => 'ok')
									.get('/err', () => new MyError('boom')),
								log
							),
							'root-after',
							log
						),
					[post(`${shape.prefix}/`), get(`${shape.prefix}/err`)],
					log
				)

				// A hook reaches only the routes registered after it, as in
				// Elysia 1: root-after's never reaches R, but `request` runs
				// before routing
				const order = (type: string) => [
					'root-before',
					...shape.between(type),
					'R',
					...(type === 'request' ? ['root-after'] : [])
				]

				expect([ok!.status, ok!.body]).toEqual([200, 'ok'])
				expectOrder(ok!.log, okTypes, order)

				expect(error!.status).toBe(500)
				expectOrder(error!.log, errorTypes, order)
			})

			it(`${shape.name}: a root observer registered before .use sees a plugin-handled error`, async () => {
				const seen: string[] = []
				const [served] = await serve(
					lane,
					(base) =>
						shape.mount(
							base.onError(({ error }: any) => {
								seen.push((error as Error).message)
							}),
							new Elysia()
								.onError(MyError, () => status(403, 'plugin'))
								.get('/', () => new MyError('boom')),
							[]
						),
					[get(`${shape.prefix}/`)]
				)

				expect([served!.status, served!.body]).toEqual([403, 'plugin'])
				expect(seen).toEqual(['boom'])
			})
		}

		// error included: only a `.group()`/`.guard()` callback's error hooks
		// cover its earlier routes
		it('local hooks a plugin registers after its route skip it', async () => {
			const log: Log = []
			const [ok, error] = await serve(
				lane,
				(base) =>
					base.use(
						hooks(
							hooks(new Elysia(), 'R', log)
								.post('/', () => 'ok')
								.get('/err', () => new MyError('boom')),
							'R-after',
							log
						)
					),
				[post('/'), get('/err')],
				log
			)

			expect([ok!.status, ok!.body]).toEqual([200, 'ok'])
			// `request` is global, so R-after's applies like any other
			const perRoute = (type: string) =>
				type === 'request' ? ['R', 'R-after'] : ['R']
			expectOrder(ok!.log, okTypes, perRoute)

			expect(error!.status).toBe(500)
			expectOrder(error!.log, errorTypes, perRoute)
		})
	})

// Which class handler serves a returned error. The parent's handlers
// registered before `.use()` run first, so they take over an error the
// plugin already handles. Registered after, the plugin's own runs first.
// Type-level counterpart: test/types/error.ts
const routes = () =>
	new Elysia()
		.onError(MyError, () => status(403, 'plugin'))
		.get('/', () => new MyError('x'))

const cases: [
	name: string,
	define: Define,
	expected: [number, string],
	path?: string
][] = [
	[
		'parent handler before .use takes over',
		(base) =>
			base.onError(MyError, () => status(418, 'parent')).use(routes()),
		[418, 'parent']
	],
	[
		'parent handler after .use keeps the plugin handler',
		(base) =>
			base.use(routes()).onError(MyError, () => status(418, 'parent')),
		[403, 'plugin']
	],
	[
		'parent handler for another class leaves the plugin alone',
		(base) =>
			base.onError(OtherError, () => status(418, 'parent')).use(routes()),
		[403, 'plugin']
	],
	[
		'child-class parent handler does not match',
		(base) =>
			base.onError(ChildError, () => status(418, 'parent')).use(routes()),
		[403, 'plugin']
	],
	[
		'base-class parent handler matches',
		(base) =>
			base.onError(Error, () => status(418, 'parent')).use(routes()),
		[418, 'parent']
	],
	[
		'plugin handler registered after its route',
		(base) =>
			base
				.onError(MyError, () => status(418, 'parent'))
				.use(
					new Elysia()
						.get('/', () => new MyError('x'))
						.onError(MyError, () => status(403, 'plugin'))
				),
		[418, 'parent']
	],
	[
		'global parent handler',
		(base) =>
			base
				.onError('global', MyError, () => status(418, 'parent'))
				.use(routes()),
		[418, 'parent']
	],
	[
		'plugin-scoped parent handler',
		(base) =>
			base
				.onError('plugin', MyError, () => status(418, 'parent'))
				.use(routes()),
		[418, 'parent']
	],
	[
		'inside a group',
		(base) =>
			(base as any)
				.onError(MyError, () => status(418, 'parent'))
				.group('/g', (app: any) => app.use(routes())),
		[418, 'parent'],
		'/g'
	],
	[
		'inside a guard',
		(base) =>
			(base as any)
				.onError(MyError, () => status(418, 'parent'))
				.guard({}, (app: any) => app.use(routes())),
		[418, 'parent']
	],
	[
		'array .use',
		(base) =>
			base.onError(MyError, () => status(418, 'parent')).use([routes()]),
		[418, 'parent']
	],
	[
		'grandparent before .use of a plugin with its own handler',
		(base) =>
			base
				.onError(MyError, () => status(451, 'grandparent'))
				.use(
					new Elysia()
						.onError(MyError, () => status(418, 'parent'))
						.use(routes())
				),
		[451, 'grandparent']
	],
	[
		'grandparent before .use of a plugin with no hooks',
		(base) =>
			base
				.onError(MyError, () => status(451, 'grandparent'))
				.use(new Elysia().use(routes())),
		[451, 'grandparent']
	],
	[
		'grandparent before .use of a plugin with only .derive',
		(base) =>
			base
				.onError(MyError, () => status(451, 'grandparent'))
				.use(new Elysia().derive(() => ({ a: 1 })).use(routes())),
		[451, 'grandparent']
	],
	[
		'grandparent before .use of a plugin handling an unhandled route',
		(base) =>
			base
				.onError(MyError, () => status(451, 'grandparent'))
				.use(
					new Elysia()
						.onError(MyError, () => status(418, 'parent'))
						.use(new Elysia().get('/', () => new MyError('x')))
				),
		[451, 'grandparent']
	]
]

for (const lane of lanes)
	describe(`class error handler across .use() (${lane.id})`, () => {
		for (const [name, define, expected, path = '/'] of cases)
			it(name, async () => {
				const [served] = await serve(lane, define, [get(path)])

				expect([served!.status, served!.body]).toEqual(expected)
			})

		it('only the taken-over error moves', async () => {
			const served = await serve(
				lane,
				(base) =>
					base
						.onError(MyError, () => status(418, 'parent'))
						.use(
							new Elysia()
								.onError(MyError, () => status(403, 'same'))
								.onError(OtherError, () => status(403, 'same'))
								.get('/:kind', ({ params }) =>
									params.kind === 'my'
										? new MyError('x')
										: new OtherError('y')
								)
						),
				[get('/my'), get('/other')]
			)

			expect(served.map(({ status, body }) => [status, body])).toEqual([
				[418, 'parent'],
				[403, 'same']
			])
		})
	})
