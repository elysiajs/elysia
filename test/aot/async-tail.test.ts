import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { setAsyncTail, setOnEmit } from '../../src/compile/handler/jit'
import { trace } from '../../src/plugin/trace'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

// A route that is `async` only because a callback *may* return a Promise is
// emitted as a sync route plus an async tail `_t` it hands the first thenable
// to. The tail must behave exactly like the plain `async` lane the route
// would otherwise compile to: same responses, same hook order, same
// afterResponse / dispose, for a thenable, a rejection, a throw and an abort
// at every await point. Each case builds the route twice, tail on and off.

afterEach(() => {
	setAsyncTail(undefined)
	setOnEmit(undefined)
	Compiled.clear()
	Validator.clear()
})

type Mode =
	| 'value'
	| 'promise'
	| 'reject'
	| 'throw'
	| 'abort'
	| 'thenable'
	| 'thenable-reject'
const modes: Mode[] = [
	'value',
	'promise',
	'reject',
	'throw',
	'abort',
	'thenable',
	'thenable-reject'
]

interface Run {
	log: string[]
	ac: AbortController
	mode: Record<string, Mode>
}

type Site = (
	name: string,
	value: (c: any) => unknown,
	effect?: (c: any) => void
) => (c: any) => unknown

// What a callback returns in each mode: its value, a native Promise, or a
// non-native thenable (awaited through its own `then`)
const resolveMode = (run: Run, name: string, value: () => unknown) => {
	const mode = run.mode[name] ?? 'value'
	if (mode === 'throw') throw new Error(`${name} threw`)
	if (mode === 'reject') return Promise.reject(new Error(`${name} rejected`))
	if (mode === 'promise') return Promise.resolve().then(value)
	if (mode === 'abort')
		return Promise.resolve().then(() => {
			run.ac.abort()
			return value()
		})
	if (mode === 'thenable')
		return {
			then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
				queueMicrotask(() => {
					try {
						resolve(value())
					} catch (error) {
						reject(error)
					}
				})
			}
		}
	if (mode === 'thenable-reject')
		return {
			then(_: unknown, reject: (e: unknown) => void) {
				reject(new Error(`${name} thenable rejected`))
			}
		}

	return value()
}

// Not `async`, may return a Promise: the shape the async tail serves
const siteOf =
	(run: Run): Site =>
	(name, value, effect) =>
	(c) => {
		run.log.push(name)
		effect?.(c)

		return resolveMode(run, name, () => value(c))
	}

// The same, never reading the context: sucrose infers nothing for it, so a
// route of such callbacks keeps the smallest emission (e.g. the handler-only
// branch, which a context-reading callback widens away)
const bareSiteOf = (run: Run) => (name: string, value: () => unknown) => () => {
	run.log.push(name)

	return resolveMode(run, name, value)
}

interface Scenario {
	name: string
	sites: string[]
	build(site: Site, run: Run): Elysia<any, any, any, any, any, any, any>
	headers?: Record<string, string>
	// what the emitted route must contain, so the scenario covers its shape
	emits: string[]
	// ms for afterResponse / dispose / stream observers to settle
	settle?: number
}

const disposable = (run: Run) => ({
	[Symbol.dispose]() {
		run.log.push('dispose')
	}
})

const scenarios: Scenario[] = [
	{
		// the transform's await points come before `_r` is declared
		name: 'transform, beforeHandle, handler',
		emits: [
			'return _t(c,0,_tf,undefined,undefined',
			'return _t(c,2,tmp,_r,undefined'
		],
		sites: ['tf0', 'tf1', 'bh', 'handler'],
		build: (site) =>
			new Elysia().get(
				'/',
				{
					transform: [site('tf0', () => {}), site('tf1', () => {})],
					beforeHandle: site('bh', () => undefined)
				},
				site('handler', () => 'ok')
			)
	},
	{
		// the handler-only branch: `_r` must reach the final map
		name: 'handler + error hook',
		emits: [
			'let _r\n_r=h(c)\n',
			'let _r=_lr\n',
			'if(_rk>=2)throw _le',
			'return _t(c,2,_r,undefined,e'
		],
		sites: ['handler', 'error'],
		build: (_, run) => {
			const site = bareSiteOf(run)

			return new Elysia().error(site('error', () => 'recovered')).get(
				'/',
				site('handler', () => 'ok')
			)
		}
	},
	{
		name: 'handler + error hook, context-reading',
		emits: ['if(_rk>=2)throw _le', 'return _t(c,2,_r,undefined,e'],
		sites: ['handler', 'error'],
		build: (site) =>
			new Elysia().error(site('error', () => 'recovered')).get(
				'/',
				site('handler', () => 'ok')
			)
	},
	{
		name: 'handler + two error hooks',
		emits: ['if(_rk>=2)throw _le', 'return _t(c,3,_r,undefined,e'],
		sites: ['handler', 'e0', 'e1'],
		build: (site) =>
			new Elysia()
				.error(site('e0', () => undefined))
				.error(site('e1', (c) => `recovered ${c.error?.message}`))
				.get(
					'/',
					site('handler', () => 'ok')
				)
	},
	{
		name: 'derive, beforeHandle, handler, response schema, error hook',
		emits: ['dsp(c,', '_vr.EncodeFrom', 'if(_rk>=4)throw _le'],
		sites: ['derive', 'bh', 'handler', 'error'],
		headers: { 'x-user': 'a' },
		build: (site) =>
			new Elysia()
				.error(site('error', () => 'recovered'))
				.derive(site('derive', (c) => ({ user: c.headers['x-user'] })))
				.beforeHandle(
					site('bh', (c) => (c.user ? undefined : c.status(401)))
				)
				.get(
					'/',
					{ response: t.String() },
					site('handler', (c) => `hi ${c.user}`)
				)
	},
	{
		// replaces `c`: the tail must continue on the replaced context
		name: 'mapDerive (context replacement)',
		emits: ['c=rdc(c,tmp)'],
		sites: ['derive', 'bh', 'handler'],
		build: (site) =>
			new Elysia()
				.mapDerive(site('derive', () => ({ user: 'u' })))
				.beforeHandle(
					site('bh', (c) => (c.user === 'u' ? undefined : 'lost'))
				)
				.get(
					'/',
					site('handler', (c) => `hi ${c.user}`)
				)
	},
	{
		name: 'beforeHandle chain short-circuits',
		emits: ["if(_rk<=2&&(_rk===2||!c['~sig']?.aborted&&_r===undefined))"],
		sites: ['bh0', 'bh1', 'bh2', 'handler'],
		build: (site) =>
			new Elysia().get(
				'/',
				{
					beforeHandle: [
						site('bh0', () => undefined),
						site('bh1', () => 'short'),
						site('bh2', () => 'never')
					]
				},
				site('handler', () => 'ok')
			)
	},
	{
		// `_r` is live across the afterHandle / mapResponse await points
		name: 'afterHandle chain, mapResponse, response schema',
		emits: [
			'if(_rk<4){\nif(tmp!==undefined)_r=c.responseValue=tmp',
			'return _t(c,3,tmp,_r,undefined'
		],
		sites: ['handler', 'ah0', 'ah1', 'mr'],
		build: (site) =>
			new Elysia().get(
				'/',
				{
					response: t.String(),
					afterHandle: [
						site('ah0', () => undefined),
						site('ah1', (c) => `${c.responseValue}!`)
					],
					mapResponse: site('mr', () => undefined)
				},
				site('handler', () => 'ok')
			)
	},
	{
		// the observed stream (`_stl`) and its discard slot are carried
		name: 'stream with afterResponse, no error hook',
		settle: 5,
		emits: ['_stl=_s[1]', ',_stl,_sv)', '_sv?.return()'],
		sites: ['handler', 'ah'],
		build: (site, run) =>
			new Elysia()
				.afterResponse(() => {
					run.log.push('afterResponse')
				})
				.get(
					'/',
					{ afterHandle: site('ah', () => undefined) },
					site('handler', () =>
						(async function* () {
							try {
								yield 'a'
								// afterResponse waits for the stream; an abort exit stops it
								await Bun.sleep(2)
								run.log.push('stream end')
								yield 'b'
								run.log.push('after b')
								yield 'c'
							} finally {
								run.log.push('stream closed')
							}
						})()
					)
				)
	},
	{
		name: 'derive dispose with a stream',
		emits: ['dds(c)', ',_stl,_sv)'],
		sites: ['derive', 'handler'],
		build: (site, run) =>
			new Elysia()
				.derive(site('derive', () => ({ res: disposable(run) })))
				.get(
					'/',
					site('handler', () =>
						(function* () {
							yield 'a'
							yield 'b'
						})()
					)
				)
	},
	{
		// the error path schedules afterResponse through `fre`
		name: 'afterResponse scheduling without an error hook',
		emits: [
			'if(c._arf)return fre(rt,c,e)',
			'return _t(c,3,tmp,_r,undefined'
		],
		sites: ['bh', 'handler', 'ah', 'mr'],
		build: (site, run) =>
			new Elysia()
				.afterResponse(() => {
					run.log.push('afterResponse')
				})
				.get(
					'/',
					{
						beforeHandle: site('bh', () => undefined),
						afterHandle: site('ah', () => undefined),
						mapResponse: site('mr', () => undefined)
					},
					site('handler', () => 'ok')
				)
	},
	{
		// signs on the success lane and through `_sfre` on the error lane
		name: 'signed cookie',
		emits: ['scv(c.set.cookie,cc)', '_sfre(rt,c,'],
		sites: ['bh', 'handler'],
		build: (site) =>
			new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
				'/',
				{
					beforeHandle: site(
						'bh',
						() => undefined,
						(c) => {
							c.cookie.session.value = 'early'
						}
					)
				},
				site(
					'handler',
					() => 'ok',
					(c) => {
						c.cookie.session.value = 'late'
					}
				)
			)
	},
	{
		name: 'static handler with a beforeHandle and an error hook',
		emits: [
			'if(_rk<1){\nif(_r===undefined){\n_r=cr(h)',
			'if(_rk>=2)throw _le'
		],
		sites: ['bh', 'error'],
		build: (site) =>
			new Elysia()
				.error(site('error', () => 'recovered'))
				.get(
					'/',
					{ beforeHandle: site('bh', () => undefined) },
					'static'
				)
	}
]

// Every single-site mode, and every ordered pair of modes: a second await
// point then runs inside the tail itself
const combinations = (sites: string[]) => {
	const out: Record<string, Mode>[] = []
	for (const s of sites) for (const m of modes) out.push({ [s]: m })
	for (let i = 0; i < sites.length; i++)
		for (let j = i + 1; j < sites.length; j++)
			for (const a of modes)
				for (const b of modes)
					out.push({ [sites[i]]: a, [sites[j]]: b })

	return out
}

const emitted: string[] = []

// A hand-off passes route locals into the tail; each must be declared at that
// point of the sync route, or the hand-off throws a ReferenceError (e.g. `_r`
// in its TDZ at a transform) instead of reaching the tail
const expectDeclaredHandoffs = (code: string) => {
	const route = code.slice(code.indexOf('function route(c){'))
	let handoffs = 0

	for (const match of route.matchAll(/return _t\(c,\d+,\w+,([^)]*)\)/g)) {
		handoffs++
		const before = route.slice(0, match.index)
		for (const local of match[1]!.split(','))
			if (local !== 'undefined')
				expect({
					local,
					declared: new RegExp(
						`let (?:[\\w$]+(?:=[^,\\n]*)?,)*${local}\\b|catch\\(${local}\\)`
					).test(before)
				}).toEqual({ local, declared: true })
	}

	return handoffs
}

const serve = async (
	scenario: Scenario,
	mode: Record<string, Mode>,
	tail: boolean
) => {
	const run: Run = { log: [], ac: new AbortController(), mode }
	setAsyncTail(tail)
	setOnEmit((code) => emitted.push(code))
	const app = scenario.build(siteOf(run), run)

	let response: Response
	try {
		response = await app.handle(
			new Request('http://localhost/', {
				headers: scenario.headers,
				signal: run.ac.signal
			})
		)
	} finally {
		setAsyncTail(undefined)
		setOnEmit(undefined)
	}

	const body = await response.text().catch((e) => `body error: ${e}`)
	// afterResponse, dispose and stream observers settle after the response
	await Bun.sleep(scenario.settle ?? 0)

	return {
		status: response.status,
		headers: [...response.headers].sort(),
		body,
		log: run.log
	}
}

describe('async tail', () => {
	for (const scenario of scenarios)
		it(`matches the async lane: ${scenario.name}`, async () => {
			emitted.length = 0
			await serve(scenario, {}, true)
			const source = emitted.join('\n')
			expect(source).toContain('async function _t(')
			for (const shape of scenario.emits) expect(source).toContain(shape)
			let handoffs = 0
			for (const code of emitted) handoffs += expectDeclaredHandoffs(code)
			// every callback's await point, plus the final map's
			expect(handoffs).toBe(scenario.sites.length + 1)

			const outcomes = new Set<string>()
			for (const mode of combinations(scenario.sites)) {
				const tail = await serve(scenario, mode, true)
				const reference = await serve(scenario, mode, false)

				expect({ mode, ...tail }).toEqual({ mode, ...reference })
				outcomes.add(JSON.stringify([tail.status, tail.body]))
			}

			// success, error and abort outcomes all occur
			expect(outcomes.size).toBeGreaterThanOrEqual(3)
		})

	it('keeps trace routes on the async lane', async () => {
		const sources: string[] = []
		setOnEmit((code) => sources.push(code))
		const app = new Elysia()
			.use(trace())
			.trace(() => {})
			.get(
				'/',
				{ beforeHandle: () => Promise.resolve() as any },
				() => 'ok'
			)

		expect(
			await app
				.handle(new Request('http://localhost/'))
				.then((r) => r.text())
		).toBe('ok')
		expect(sources.join('')).not.toContain('async function _t(')
	})

	// the tail cannot resume inside an error hook's mapResponse chain
	it('keeps an error hook with mapResponse on the async lane', async () => {
		const sources: string[] = []
		setOnEmit((code) => sources.push(code))
		const app = new Elysia()
			.error(() => Promise.resolve('recovered') as any)
			.mapResponse(() => undefined)
			.get('/', () => Promise.reject(new Error('late')) as any)

		expect(
			await app
				.handle(new Request('http://localhost/'))
				.then((r) => r.text())
		).toBe('recovered')
		expect(sources.join('')).not.toContain('async function _t(')
		expect(sources.join('')).toContain('async function route(')
	})

	// The sync route probes `then` once before handing off; the tail must not
	// probe the resumed value again, or it reads `then` once more than the
	// `async` lane (which reads it twice: the probe, then `await`)
	it('reads a resumed thenable exactly as often as the async lane', async () => {
		const serveStateful = async (tail: boolean) => {
			setAsyncTail(tail)
			try {
				const app = new Elysia().get(
					'/',
					{ response: t.String() },
					() => {
						let reads = 0
						const thenable = {}
						// a thenable only on its first two reads
						Object.defineProperty(thenable, 'then', {
							get: () =>
								++reads <= 2
									? (resolve: (v: string) => void) =>
											resolve('ok')
									: undefined
						})

						return thenable as any
					}
				)
				const response = await app.handle(
					new Request('http://localhost/')
				)

				return [response.status, await response.text()]
			} finally {
				setAsyncTail(undefined)
			}
		}

		expect(await serveStateful(false)).toEqual([200, 'ok'])
		expect(await serveStateful(true)).toEqual([200, 'ok'])
	})

	// Measured: JSC runs these routes faster with the tail, V8 on the plain
	// `async` lane. An AOT capture follows its declared target
	describe('runtime gate', () => {
		const app = () =>
			new Elysia().get(
				'/',
				{ beforeHandle: () => Promise.resolve() as any },
				() => 'ok'
			)

		it('uses the tail on Bun by default', () => {
			const sources: string[] = []
			setOnEmit((code) => sources.push(code))
			app().compile()
			expect(sources.join('')).toContain('async function _t(')
		})

		for (const [target, lane] of [
			['bun', 'async function _t('],
			['node', 'async function route('],
			['workerd', 'async function route(']
		] as const)
			it(`captures for AOT target '${target}' on its lane`, async () => {
				const { handlers } = await captureArtifacts(app(), { target })
				const code = handlers.map((h) => h.code).join('')
				expect(code).toContain(lane)
				if (target !== 'bun') expect(code).not.toContain('_t(')
			})
	})
})
