import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia, status, type AnyElysia, type Context } from '../../src'
import { createAdapter } from '../../src/adapter'
import { defaultAdapter } from '../../src/adapter/constants'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { JITProbe } from '../../src/compile/jit-probe'
import { Validator } from '../../src/validator'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from '../aot/_manifest'

type MapperCall = { kind: 'map' | 'compact'; args: unknown[] }

const recordingAdapter = (hasCompact: boolean) => {
	const calls: MapperCall[] = []
	const { compact, ...response } = defaultAdapter.response
	const adapter = createAdapter({
		...defaultAdapter,
		response: {
			...response,
			map: (...args) => {
				calls.push({ kind: 'map', args })
				return Reflect.apply(response.map, undefined, args)
			},
			...(hasCompact
				? {
						compact: (...args: unknown[]) => {
							calls.push({ kind: 'compact', args })
							return Reflect.apply(compact!, undefined, args)
						}
					}
				: {})
		}
	})
	return { adapter, calls }
}

type Shape =
	| 'plain'
	| 'derive'
	| 'async'
	| 'thenable'
	| 'set'
	| 'headers'
	| 'afterHandle'
	| 'mapResponse'

const build = (
	shape: Shape,
	adapter: ReturnType<typeof recordingAdapter>['adapter'],
	sets: Context['set'][] = []
): AnyElysia => {
	const app = new Elysia({ adapter })
	switch (shape) {
		case 'plain':
			return app.get('/', () => 'ok')
		case 'derive':
			return app
				.derive(() => ({ value: 'ok' }))
				.get('/', ({ value }) => value)
		case 'async':
			return app.get('/', async () => 'ok')
		case 'thenable':
			return app.get('/', () => ({
				then(resolve: (value: string) => void) {
					resolve('ok')
				}
			}))
		case 'set':
			return app.get('/', ({ set }) => {
				sets.push(set)
				set.headers['x-set'] = 'yes'
				return 'ok'
			})
		case 'headers':
			return app.headers({ 'x-default': 'yes' }).get('/', () => 'ok')
		case 'afterHandle':
			return app.afterHandle(() => 'ok').get('/', () => 'before hook')
		case 'mapResponse':
			return app.mapResponse(() => 'ok').get('/', () => 'before hook')
	}
}

const dispatchTwice = async (
	app: AnyElysia,
	calls: MapperCall[],
	withHeaders = true
) => {
	const rows = []
	// Collect both requests before asserting, so cold failure cannot hide warm failure.
	for (const phase of ['cold', 'warm']) {
		const request = new Request(
			'http://localhost/',
			withHeaders ? { headers: { 'x-phase': phase } } : undefined
		)
		const offset = calls.length
		const response = await app.handle(request)
		rows.push({
			request,
			status: response.status,
			body: await response.text(),
			headers: response.headers,
			calls: calls.slice(offset)
		})
	}
	return rows
}

const expectResponses = (
	rows: Awaited<ReturnType<typeof dispatchTwice>>,
	kind?: MapperCall['kind'],
	sets?: Context['set'][]
) => {
	expect(rows.map(({ status, body }) => ({ status, body }))).toEqual([
		{ status: 200, body: 'ok' },
		{ status: 200, body: 'ok' }
	])
	for (const [index, row] of rows.entries()) {
		expect(row.headers.get('x-phase')).toBeNull()
		expect(row.calls).toHaveLength(1)
		const call = row.calls[0]!
		if (kind) expect(call.kind).toBe(kind)
		expect(call.args[0]).toBe('ok')
		if (call.kind === 'compact') {
			expect(call.args).toHaveLength(3)
			expect(call.args[1]).toBe(row.request)
			expect(call.args[2]).toBe(true)
		} else {
			expect(call.args).toHaveLength(4)
			expect(call.args[1]).not.toBeInstanceOf(Request)
			expect(call.args[1]).toHaveProperty('headers')
			expect(call.args[1]).toHaveProperty('status')
			if (sets) expect(call.args[1]).toBe(sets[index])
			expect(call.args[2]).toBe(row.request)
			expect(call.args[3]).toBe(true)
		}
	}
}

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	JITProbe.end()
})

describe('optional adapter compact mapper', () => {
	for (const hasCompact of [true, false])
		for (const shape of [
			'plain',
			'derive',
			'async',
			'thenable',
			'set',
			'headers',
			'afterHandle',
			'mapResponse'
		] as const)
			it(`${shape}, compact=${hasCompact}: cold and warm requests use the selected mapper's arguments`, async () => {
				const { adapter, calls } = recordingAdapter(hasCompact)
				const sets: Context['set'][] = []
				const rows = await dispatchTwice(
					build(shape, adapter, sets),
					calls
				)
				const usesFull =
					!hasCompact || shape === 'set' || shape === 'headers'
				expectResponses(
					rows,
					usesFull ? 'map' : 'compact',
					shape === 'set' ? sets : undefined
				)
				if (shape === 'set')
					for (const row of rows)
						expect(row.headers.get('x-set')).toBe('yes')
				if (shape === 'headers')
					for (const row of rows)
						expect(row.headers.get('x-default')).toBe('yes')
			})

	for (const hasCompact of [true, false])
		it(`headerless requests, compact=${hasCompact}: preserve cold and warm responses`, async () => {
			const { adapter, calls } = recordingAdapter(hasCompact)
			const rows = await dispatchTwice(
				build('plain', adapter),
				calls,
				false
			)
			expectResponses(rows, hasCompact ? 'compact' : 'map')
		})

	for (const [name, makeValue, expectedStatus, expectedBody] of [
		['object', () => ({ ok: true }), 200, '{"ok":true}'],
		['Response', () => new Response('ok', { status: 202 }), 202, 'ok'],
		['status', () => status(201, 'ok'), 201, 'ok'],
		[
			'ReadableStream',
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('ok'))
						controller.close()
					}
				}),
			200,
			'ok'
		],
		['Blob', () => new Blob(['ok']), 200, 'ok'],
		[
			'generator',
			function* () {
				yield 'ok'
			},
			200,
			'ok'
		]
	] as const)
		it(`full-only adapter preserves ${name} responses`, async () => {
			const { adapter, calls } = recordingAdapter(false)
			const app = new Elysia({ adapter }).get('/', makeValue)
			const rows = await dispatchTwice(app, calls)
			for (const row of rows) {
				expect(row.status).toBe(expectedStatus)
				expect(row.body).toBe(expectedBody)
				expect(row.headers.get('x-phase')).toBeNull()
				expect(row.calls).toHaveLength(1)
				expect(row.calls[0]!.kind).toBe('map')
				expect(row.calls[0]!.args).toHaveLength(4)
				expect(row.calls[0]!.args[2]).toBe(row.request)
				expect(row.calls[0]!.args[3]).toBe(true)
			}
		})

	it('full-only adapter forwards a returned Error into the error hook', async () => {
		const { adapter, calls } = recordingAdapter(false)
		const failure = new Error('handler failure')
		const observed: unknown[] = []
		const app = new Elysia({ adapter })
			.error(({ error, set }) => {
				observed.push(error)
				set.status = 418
				return 'caught'
			})
			.get('/', () => failure)
		const rows = await dispatchTwice(app, calls)
		expect(observed).toEqual([failure, failure])
		for (const row of rows) {
			expect(row.status).toBe(418)
			expect(row.body).toBe('caught')
			expect(row.headers.get('x-phase')).toBeNull()
		}
	})

	it('binds a compact getter once when specializing a generated inline handler', async () => {
		const { adapter, calls } = recordingAdapter(true)
		const selected = adapter.response.compact!
		let reads = 0
		Object.defineProperty(adapter.response, 'compact', {
			get: () =>
				++reads === 1 ? selected : () => new Response('wrong mapper')
		})
		// Introspection bypasses the initial bare-route shortcut, exercising JIT specialization.
		const app = new Elysia({ adapter, introspect: true }).get(
			'/',
			() => 'ok'
		)
		const rows = await dispatchTwice(app, calls)
		expectResponses(rows, 'compact')
		expect(reads).toBe(1)
	})

	for (const shape of [
		'plain',
		'derive',
		'afterHandle',
		'mapResponse'
	] as const)
		for (const captureCompact of [true, false])
			for (const runtimeCompact of [true, false])
				it(`AOT ${shape}, compact ${captureCompact} -> ${runtimeCompact}: rebinds without JIT`, async () => {
					const previous = process.env.ELYSIA_AOT_BUILD
					try {
						process.env.ELYSIA_AOT_BUILD = '1'
						endHandlerCapture()
						endValidatorCapture()
						build(
							shape,
							recordingAdapter(captureCompact).adapter
						).compile()
						const handlers = endHandlerCapture()
						const validators = endValidatorCapture()
						expect(handlers).toHaveLength(1)
						const manifest = materialiseHandlers(handlers)
						const factory = manifest.GET!['/']!.f
						let factoryCalls = 0
						manifest.GET!['/']!.f = (...args: unknown[]) => {
							factoryCalls++
							return factory(...args)
						}
						delete process.env.ELYSIA_AOT_BUILD
						Validator.clear()
						registerManifest({
							handlers: manifest,
							validators: materialise(validators)
						})
						const { adapter, calls } =
							recordingAdapter(runtimeCompact)
						JITProbe.begin()
						const app = build(shape, adapter).compile()
						const rows = await dispatchTwice(app, calls)
						expect(factoryCalls).toBe(1)
						expect(JITProbe.end().reasons).toEqual([])
						expectResponses(
							rows,
							runtimeCompact ? 'compact' : 'map'
						)
					} finally {
						if (previous === undefined)
							delete process.env.ELYSIA_AOT_BUILD
						else process.env.ELYSIA_AOT_BUILD = previous
						endHandlerCapture()
						endValidatorCapture()
					}
				})
})
