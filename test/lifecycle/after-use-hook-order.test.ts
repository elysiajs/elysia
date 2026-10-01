// Hooks an instance registers AFTER `.use(R)`, for the routes R brought in.
//
// Rule: with P as the root, P's local hooks registered after `.use(R)` run
// after R's own hooks. P must behave the same once nested, so for R's routes
// reached through P the order is
//
//   [G-before, P-before, R-own, P-after, G-after]
//
// and, deeper, each level's after-use hooks run innermost first. Local hooks
// registered after a route an instance declares ITSELF still don't apply to
// that route.
//
// Plugin deduplication (`name` / `seed`) is untouched: the same routes exist,
// and P's after-use hooks attach only to the route copies that came through
// P, exactly where P's before-use hooks already attach.

import { describe, expect, it } from 'bun:test'
import { Elysia, status, t } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	nativeStaticOn,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

class MyError extends Error {
	readonly kind = 'my-error'
}

type Log = string[]

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

interface Served {
	status: number
	body: string
	log: Log
}

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

const post = (path: string, body: unknown = { a: 1 }) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

const get = (path: string) => new Request(`http://localhost${path}`)

// Register one logging hook of every per-route type, tagged
const hooks = (app: any, tag: string, log: Log) =>
	app
		.parse(() => {
			log.push(`parse:${tag}`)
		})
		.transform(() => {
			log.push(`transform:${tag}`)
		})
		.derive(() => {
			log.push(`derive:${tag}`)
			return {}
		})
		.beforeHandle(() => {
			log.push(`beforeHandle:${tag}`)
		})
		.afterHandle(() => {
			log.push(`afterHandle:${tag}`)
		})
		.mapResponse(() => {
			log.push(`mapResponse:${tag}`)
		})
		.afterResponse(() => {
			log.push(`afterResponse:${tag}`)
		})
		.error(() => {
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

const okTypes = [
	'parse',
	'transform',
	'derive',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse'
]
const errorTypes = [
	'transform',
	'derive',
	'beforeHandle',
	'error',
	'afterResponse'
]

const expectOrder = (log: Log, types: string[], order: string[]) => {
	const rows = byType(log)

	expect(Object.keys(rows).sort()).toEqual([...types].sort())
	for (const type of types)
		expect({ type, order: rows[type] }).toEqual({ type, order })
}

const plugin = (log: Log) =>
	hooks(new Elysia(), 'R', log)
		.post('/', () => 'ok')
		.get('/err', () => new MyError('boom'))

// `P-before`, `.use(child)`, `P-after`
const around = (tag: string, child: any, log: Log, before = true) =>
	hooks(
		(before ? hooks(new Elysia(), `${tag}-before`, log) : new Elysia()).use(
			child
		),
		`${tag}-after`,
		log
	)

interface Shape {
	name: string
	prefix: string
	define(base: any, log: Log): any
	order: string[]
}

const shapes: Shape[] = [
	{
		name: 'P as the root',
		prefix: '',
		define: (base, log) =>
			hooks(
				hooks(base, 'P-before', log).use(plugin(log)),
				'P-after',
				log
			),
		order: ['P-before', 'R', 'P-after']
	},
	{
		name: 'G.use(P.use(R))',
		prefix: '',
		define: (base, log) =>
			hooks(
				hooks(base, 'G-before', log).use(around('P', plugin(log), log)),
				'G-after',
				log
			),
		order: ['G-before', 'P-before', 'R', 'P-after', 'G-after']
	},
	{
		name: 'G.use(Q.use(P.use(R)))',
		prefix: '',
		define: (base, log) =>
			hooks(
				hooks(base, 'G-before', log).use(
					around('Q', around('P', plugin(log), log), log)
				),
				'G-after',
				log
			),
		order: [
			'G-before',
			'Q-before',
			'P-before',
			'R',
			'P-after',
			'Q-after',
			'G-after'
		]
	},
	{
		name: 'P has no hooks before .use(R)',
		prefix: '',
		define: (base, log) =>
			hooks(
				hooks(base, 'G-before', log).use(
					around('P', plugin(log), log, false)
				),
				'G-after',
				log
			),
		order: ['G-before', 'R', 'P-after', 'G-after']
	},
	{
		name: 'G has no hooks before .use(P)',
		prefix: '',
		define: (base, log) =>
			hooks(base.use(around('P', plugin(log), log)), 'G-after', log),
		order: ['P-before', 'R', 'P-after', 'G-after']
	},
	{
		name: 'only P-after',
		prefix: '',
		define: (base, log) => base.use(around('P', plugin(log), log, false)),
		order: ['R', 'P-after']
	},
	{
		name: 'guard inside P',
		prefix: '',
		define: (base, log) =>
			hooks(
				hooks(base, 'G-before', log).use(
					hooks(
						hooks(new Elysia(), 'P-before', log).guard(
							{},
							(app: any) => app.use(plugin(log))
						),
						'P-after',
						log
					)
				),
				'G-after',
				log
			),
		order: ['G-before', 'P-before', 'R', 'P-after', 'G-after']
	},
	{
		name: 'group inside P',
		prefix: '/g',
		define: (base, log) =>
			hooks(
				hooks(base, 'G-before', log).use(
					hooks(
						hooks(new Elysia(), 'P-before', log).group(
							'/g',
							(app: any) => app.use(plugin(log))
						),
						'P-after',
						log
					)
				),
				'G-after',
				log
			),
		order: ['G-before', 'P-before', 'R', 'P-after', 'G-after']
	}
]

for (const lane of lanes)
	describe(`after-use hook order (${lane.id})`, () => {
		for (const shape of shapes)
			it(`${shape.name}: every hook type in order`, async () => {
				const log: Log = []
				const [ok, error] = await serve(
					lane,
					(base) => shape.define(base, log),
					[post(`${shape.prefix}/`), get(`${shape.prefix}/err`)],
					log
				)

				expect([ok!.status, ok!.body]).toEqual([200, 'ok'])
				expectOrder(ok!.log, okTypes, shape.order)

				expect(error!.status).toBe(500)
				expectOrder(error!.log, errorTypes, shape.order)
			})

		it("P's hooks registered after its OWN route skip it, nested or not", async () => {
			const log: Log = []
			const P = () =>
				hooks(
					hooks(new Elysia(), 'P-before', log).post('/', () => 'ok'),
					'P-after',
					log
				)

			for (const define of [
				(base: any) => base.use(P()),
				(base: any) => hooks(base, 'G-before', log).use(P())
			] as Define[]) {
				const [ok] = await serve(lane, define, [post('/')], log)

				expect([ok!.status, ok!.body]).toEqual([200, 'ok'])
				expect(
					ok!.log.some((entry) => entry.endsWith(':P-after'))
				).toBe(false)
			}
		})

		it('a class handler registered after .use(R) serves nested like at the root', async () => {
			const P = () =>
				new Elysia()
					.use(
						new Elysia().get('/', () => {
							throw new MyError('x')
						})
					)
					.error(MyError, () => status(404, 'p-after-use'))

			for (const define of [
				(base: any) => base.use(P()),
				(base: any) => base.use(new Elysia().use(P()))
			] as Define[]) {
				const [served] = await serve(lane, define, [get('/')])

				expect([served!.status, served!.body]).toEqual([
					404,
					'p-after-use'
				])
			}
		})

		it('a guard registered after .use(R) validates nested like at the root', async () => {
			const P = () =>
				new Elysia()
					.use(
						new Elysia().post(
							'/',
							({ body }: any) => body.a as string
						)
					)
					.guard({ body: t.Object({ a: t.String() }) })

			for (const define of [
				(base: any) => base.use(P()),
				(base: any) => base.use(new Elysia().use(P()))
			] as Define[]) {
				const [valid, invalid] = await serve(lane, define, [
					post('/', { a: 'x' }),
					post('/', { a: 1 })
				])

				expect([valid!.status, valid!.body]).toEqual([200, 'x'])
				expect(invalid!.status).toBe(422)
			}
		})
	})

// A static route only gets promoted to a native Bun static response when no
// hook applies to it, so an after-use hook must keep it off that path
it('an after-use hook keeps a nested static route off the native static path', async () => {
	const log: Log = []
	const [served] = await serve(
		nativeStaticOn,
		(base) =>
			base.use(
				new Elysia()
					.use(new Elysia().get('/', 'static'))
					.beforeHandle(() => {
						log.push('P-after')
					})
			),
		[get('/')],
		log
	)

	expect([served!.status, served!.body]).toEqual([200, 'static'])
	expect(served!.log).toEqual(['P-after'])
})

// Routes whose absorbing instance registered no local hook after them keep
// their chain unchanged, so the compact beforeHandle path still applies
it('routes with no after-use hook carry no tail', () => {
	const P = new Elysia().beforeHandle(() => {})

	for (let i = 0; i < 5; i++)
		P.use(
			new Elysia().beforeHandle('global', () => {}).get(`/c${i}`, () => i)
		)

	const chains = (app: any) =>
		app['~routes'].map((route: any) => route[6] && 'tail' in route[6])

	expect(chains(new Elysia().use(P))).toEqual([
		false,
		false,
		false,
		false,
		false
	])

	P.beforeHandle(() => {})

	expect(chains(new Elysia().use(P))).toEqual([true, true, true, true, true])
})

// Plugin deduplication. For each shape: which route copies exist (history),
// which tagged beforeHandle hooks each copy composes, and what serves. The
// only difference from before the fix is `P-after` appearing next to
// `P-before`, on the copies that came through P
describe('after-use hooks and plugin deduplication', () => {
	const log: Log = []
	const tags = new Map<Function, string>()
	const tagged = (tag: string) => {
		const fn = () => {
			log.push(tag)
		}
		tags.set(fn, tag)
		return fn
	}

	const R = (name?: string, seed?: unknown, path = '/r', tag = 'R-own') =>
		new Elysia(name ? ({ name, seed } as any) : undefined)
			.beforeHandle(tagged(tag))
			.get(path, () => tag)

	const P = (tag: string, child: any) =>
		new Elysia()
			.beforeHandle(tagged(`${tag}-before`))
			.use(child)
			.beforeHandle(tagged(`${tag}-after`))

	// Every beforeHandle a route copy runs, the compact inherited prefix first
	const composed = (app: any) =>
		app.routes.map((route: any, i: number) => {
			const source = app.history[i].source
			const prefix: Function[] = []
			for (
				let chunk = route.hooks?.['~beforeHandlePrefix']?.tail;
				chunk;
				chunk = chunk.parent
			)
				prefix.unshift(...chunk.values)

			const own = route.hooks?.beforeHandle ?? []

			return `${route.method} ${route.path}${source ? `(${source})` : ''} [${[
				...prefix,
				...(Array.isArray(own) ? own : [own])
			]
				.map((fn: Function) => tags.get(fn) ?? '?')
				.join(', ')}]`
		})

	const cases: [
		name: string,
		build: (root: any) => any,
		routes: string[],
		served: Record<string, string[]>
	][] = [
		[
			// Named R is registered directly on G first. P's copy of R's route is
			// still emitted (unnamed P isn't deduplicated) and, registered
			// later, is the one that serves: it already ran P-before
			'(a) G.use(R named).use(P.use(R named))',
			(root) => {
				const r = R('R')
				return root.use(r).use(P('P', r))
			},
			['GET /r(R) [R-own]', 'GET /r [P-before, R-own, P-after]'],
			{ '/r': ['P-before', 'R-own', 'P-after'] }
		],
		[
			'(b) G.use(P.use(R named)).use(R named): the second use is deduplicated',
			(root) => {
				const r = R('R')
				return root.use(P('P', r)).use(r)
			},
			['GET /r [P-before, R-own, P-after]'],
			{ '/r': ['P-before', 'R-own', 'P-after'] }
		],
		[
			'(c) G.use(P1.use(R named)).use(P2.use(R named))',
			(root) => {
				const r = R('R')
				return root.use(P('P1', r)).use(P('P2', r))
			},
			[
				'GET /r [P1-before, R-own, P1-after]',
				'GET /r [P2-before, R-own, P2-after]'
			],
			{ '/r': ['P2-before', 'R-own', 'P2-after'] }
		],
		[
			'(d) same name, different seed',
			(root) =>
				root
					.use(P('P1', R('R', 1, '/r1', 'R1-own')))
					.use(P('P2', R('R', 2, '/r2', 'R2-own'))),
			[
				'GET /r1 [P1-before, R1-own, P1-after]',
				'GET /r2 [P2-before, R2-own, P2-after]'
			],
			{
				'/r1': ['P1-before', 'R1-own', 'P1-after'],
				'/r2': ['P2-before', 'R2-own', 'P2-after']
			}
		],
		[
			'(e) unnamed R used through two parents',
			(root) => {
				const u = R(undefined, undefined, '/u', 'U-own')
				return root.use(P('P1', u)).use(P('P2', u))
			},
			[
				'GET /u [P1-before, U-own, P1-after]',
				'GET /u [P2-before, U-own, P2-after]'
			],
			{ '/u': ['P2-before', 'U-own', 'P2-after'] }
		],
		[
			'(e) unnamed R used directly and through P',
			(root) => {
				const u = R(undefined, undefined, '/u', 'U-own')
				return root.use(u).use(P('P', u))
			},
			['GET /u [U-own]', 'GET /u [P-before, U-own, P-after]'],
			{ '/u': ['P-before', 'U-own', 'P-after'] }
		],
		[
			'(f) a global hook on R still propagates as before',
			(root) => {
				const r = new Elysia({ name: 'Rg' })
					.beforeHandle('global', tagged('R-global'))
					.get('/r', () => 'r')

				return root
					.get('/g0', () => 'g0')
					.use(P('P', r))
					.use(r)
					.get('/g', () => 'g')
			},
			[
				'GET /g0 []',
				'GET /r [P-before, R-global, P-after]',
				'GET /g [R-global]'
			],
			{
				'/r': ['P-before', 'R-global', 'P-after'],
				'/g0': [],
				'/g': ['R-global']
			}
		]
	]

	for (const [name, build, routes, served] of cases) {
		it(`${name}: routes and composed hooks`, () => {
			expect(composed(build(new Elysia()))).toEqual(routes)
		})

		for (const lane of lanes)
			it(`${name}: served (${lane.id})`, async () => {
				const paths = Object.keys(served)
				const results = await serve(lane, build, paths.map(get), log)

				expect(
					Object.fromEntries(
						results.map((result, i) => [paths[i], result.log])
					)
				).toEqual(served)
			})
	}
})
