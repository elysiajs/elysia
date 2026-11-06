import { afterEach, describe, expect, it } from 'bun:test'

import { Elysia, sse, status, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { compileToSource } from '../../src/plugin/aot/source'
import { claimManifest, evalRegistration, materialise } from './_manifest'

/**
 * A frozen route replays the code the JIT emitted and a mirror from the
 * manifest. Its chunks have to be cleaned by that mirror: `Function` is blocked
 * below as in a binary built without string code, so a route that fell back to
 * a live one fails instead of passing on the JIT's behavior.
 */

const realFunction = globalThis.Function

afterEach(() => {
	;(globalThis as any).Function = realFunction
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const frozenBody = async (build: () => any, path = '/') => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const source = await compileToSource(build())
	delete process.env.ELYSIA_AOT_BUILD

	Validator.clear()
	Compiled.register(evalRegistration(source))

	const blocked = () => {
		throw new EvalError('Code generation from strings disallowed')
	}

	;(globalThis as any).Function = new Proxy(realFunction, {
		apply: blocked,
		construct: blocked
	})

	try {
		const app = build()
		const response = await app.handle(
			new Request(`http://localhost${path}`)
		)

		return { status: response.status, body: await response.text() }
	} finally {
		;(globalThis as any).Function = realFunction
	}
}

const object = t.Object({ a: t.Number() })

const yields = (...chunks: unknown[]) =>
	function* () {
		yield* chunks
	} as () => Generator<any>

describe('generator chunks of a frozen route', () => {
	it('strips the first and the later chunks', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ response: object },
				yields({ a: 1, secret: 'x' }, { a: 2, secret: 'x' })
			)

		expect(await frozenBody(build)).toEqual({
			status: 200,
			body: '{"a":1}{"a":2}'
		})
	})

	it('strips the chunks of an async generator', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ response: object },
				async function* (): AsyncGenerator<any> {
					yield { a: 1, secret: 'x' }
					yield { a: 2, secret: 'x' }
				}
			)

		expect((await frozenBody(build)).body).toBe('{"a":1}{"a":2}')
	})

	it('picks the schema of the status the stream is sent with', async () => {
		const response = {
			200: object,
			201: t.Object({ b: t.Number() })
		}

		const set = () =>
			new Elysia().get(
				'/',
				{ response },
				function* ({ set }): Generator<any> {
					set.status = 201
					yield { a: 1, b: 2 }
				}
			)

		const wrapped = () =>
			new Elysia().get(
				'/',
				{ response },
				() => status(201, yields({ a: 1, b: 2 })() as any) as any
			)

		expect(await frozenBody(set)).toEqual({ status: 201, body: '{"b":2}' })

		Compiled.clear()
		Validator.clear()

		expect(await frozenBody(wrapped)).toEqual({
			status: 201,
			body: '{"b":2}'
		})
	})

	it('keeps the framing of an sse chunk beside a plain one', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ response: t.Object({ data: t.Object({ n: t.String() }) }) },
				yields(sse({ event: 'e', id: 1, data: { n: 'a', s: 1 } }), {
					data: { n: 'b', s: 1 }
				})
			)

		expect((await frozenBody(build)).body).toBe(
			'id: 1\nevent: e\ndata: {"n":"a"}\n\n' +
				'data: {"data":{"n":"b"}}\n\n'
		)
	})

	it('sends a chunk without fields, and strips one with them', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ response: object },
				yields(
					'text',
					new Uint8Array([104]),
					{ b: 1, secret: 'x' },
					{ a: 1, s: 1 }
				)
			)

		expect((await frozenBody(build)).body).toBe('texth{}{"a":1}')
	})

	it('errors the stream when the frozen mirror throws', async () => {
		const nested = t.Object({ a: t.Object({ y: t.String() }) })
		const bad = { a: null, secret: 'x' }

		const first = () =>
			new Elysia().get('/', { response: nested }, yields(bad))
		const later = () =>
			new Elysia().get(
				'/',
				{ response: nested },
				yields({ a: { y: 'q' } }, bad)
			)

		await expect(frozenBody(first)).rejects.toBeInstanceOf(TypeError)

		Compiled.clear()
		Validator.clear()

		await expect(frozenBody(later)).rejects.toBeInstanceOf(TypeError)
	})

	it('cleans the data of sse(generator)', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ response: t.Object({ data: t.Object({ n: t.String() }) }) },
				() =>
					sse(
						(function* () {
							yield { n: 'a', secret: 'x' }
						})()
					)
			)

		expect((await frozenBody(build)).body).toBe('data: {"n":"a"}\n\n')
	})

	it('sanitizes a chunk with the frozen mirror', async () => {
		const build = () =>
			new Elysia({
				sanitize: (value) => value.replaceAll('<', '&lt;')
			}).get(
				'/',
				{ response: t.Object({ name: t.String() }) },
				yields({ name: '<b>', secret: 'x' })
			)

		expect((await frozenBody(build)).body).toBe('{"name":"&lt;b>"}')
	})

	it('cleans nothing with normalize: false', async () => {
		const build = () =>
			new Elysia({ normalize: false }).get(
				'/',
				{ response: object },
				yields({ a: 1, kept: 'x' })
			)

		expect((await frozenBody(build)).body).toBe('{"a":1,"kept":"x"}')
	})
})

// a sealed bundle has no TypeBoxValidator: the stream handler reads this `Clean`
describe('bridge-free response validator', () => {
	const frozenResponse = () => {
		const hook = { response: object }

		process.env.ELYSIA_AOT_BUILD = '1'
		endHandlerCapture()
		endValidatorCapture()

		new Elysia().get('/', hook, () => ({ a: 1 })).compile()

		endHandlerCapture()
		const validators = endValidatorCapture()
		delete process.env.ELYSIA_AOT_BUILD
		Validator.clear()

		const frozen = buildFrozenRouteValidator(
			hook as any,
			{
				...claimManifest({ validators: materialise(validators) }),
				'~config': {},
				'~ext': {}
			} as any,
			'GET',
			'/'
		)

		expect(frozen?.response).toBeDefined()

		return frozen!.response!.get(200)!
	}

	it('exposes the mirror it validates with', () => {
		expect(frozenResponse().Clean!({ a: 1, secret: 'x' })).toEqual({ a: 1 })
	})
})
