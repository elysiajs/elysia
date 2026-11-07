import { describe, it, expect, afterEach, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { compileToSource } from '../../src/plugin/aot/source'
import {
	claimManifest,
	evalRegistration,
	materialise,
	materialiseHandlers,
	registerManifest
} from './_manifest'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from '../ws/utils'

/**
 * A binary built with `--disallow-code-generation-from-strings=strict` can't
 * run `new Function`, so a mirror it needs must come from the manifest. If it
 * doesn't, sanitize is a security control that silently stops running.
 */

const realFunction = globalThis.Function

afterEach(() => {
	// a timed out test never reaches its own restore
	;(globalThis as any).Function = realFunction
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

type Build = () => any

// What strict mode does to exact-mirror's `Function('d', source)`
const withoutStringCode = async <T>(run: () => Promise<T> | T) => {
	const blocked = () => {
		throw new EvalError('Code generation from strings disallowed')
	}

	;(globalThis as any).Function = new Proxy(realFunction, {
		apply: blocked,
		construct: blocked
	})

	try {
		return await run()
	} finally {
		;(globalThis as any).Function = realFunction
	}
}

// Build through the real manifest source, like the AOT plugin
const freeze = async (build: Build) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const source = await compileToSource(build())
	delete process.env.ELYSIA_AOT_BUILD

	Validator.clear()
	Compiled.register(evalRegistration(source))

	return source
}

// The in-process capture, for a test that edits an entry before registering
const capture = (build: Build) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	endHandlerCapture()
	endValidatorCapture()

	build().compile()

	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	Validator.clear()

	return { handlers, validators }
}

const post = (body: unknown, path = '/s') =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

const result = async (app: any, request: Request) => {
	const response = await app.handle(request)

	return { status: response.status, body: await response.text() }
}

const frozenResult = async (build: Build, request: () => Request) => {
	await freeze(build)

	return withoutStringCode(() => result(build(), request()))
}

const escape = (v: string) => v.replaceAll('<', '&lt;')
// `&` -> `&amp;` is the sanitizer that shows a second pass: `&amp;amp;`
const escapeAmp = (v: string) => v.replaceAll('&', '&amp;')

const bodyRoute = (schema: () => any, sanitize: any) => () =>
	new Elysia({ sanitize }).post(
		'/s',
		{ body: schema() },
		({ body }: any) => body
	)

describe('sanitize in a frozen manifest without string code', () => {
	it('sanitizes a body', async () => {
		const build = bodyRoute(() => t.Object({ name: t.String() }), escape)

		await expect(
			frozenResult(build, () => post({ name: '<b>' }))
		).resolves.toEqual({ status: 200, body: '{"name":"&lt;b>"}' })
	})

	it('keeps the sanitizer in the app and the call in the manifest', async () => {
		const source = await freeze(
			bodyRoute(() => t.Object({ name: t.String() }), escape)
		)

		expect(source).toContain('d.h0(')
		expect(source).not.toContain('&lt;')
	})

	it('runs an array of sanitizers in order', async () => {
		const build = bodyRoute(
			() => t.Object({ name: t.String() }),
			[
				(v: string) => v + '1',
				(v: string) => v + '2',
				(v: string) => v + '3'
			]
		)

		await expect(
			frozenResult(build, () => post({ name: 'x' }))
		).resolves.toEqual({ status: 200, body: '{"name":"x123"}' })
	})

	it('reads an empty array as no sanitize, the mirror still strips', async () => {
		const build = bodyRoute(() => t.Object({ name: t.String() }), [])

		await expect(
			frozenResult(build, () => post({ name: '<b>', extra: 1 }))
		).resolves.toEqual({ status: 200, body: '{"name":"<b>"}' })
	})

	// `m`, not `cm`: here `s` is called directly, so a wrong factory guess shows
	const mirrorOnly = (build: Build) => {
		const { handlers, validators } = capture(build)

		for (const validator of validators) validator.checkValue = undefined

		const manifest = materialise(validators)
		expect(manifest.POST!['/s']!.body!.m).toBeDefined()

		registerManifest({
			handlers: materialiseHandlers(handlers),
			validators: manifest
		})
	}

	it('runs the mirror of a slot whose check was not frozen', async () => {
		const build = bodyRoute(() => t.Object({ name: t.String() }), escape)
		mirrorOnly(build)

		await expect(
			withoutStringCode(() => result(build(), post({ name: '<b>' })))
		).resolves.toEqual({ status: 200, body: '{"name":"&lt;b>"}' })
	})

	it('calls that mirror directly with an empty array', async () => {
		const build = bodyRoute(() => t.Object({ name: t.String() }), [])
		mirrorOnly(build)

		await expect(
			withoutStringCode(() =>
				result(build(), post({ name: '<b>', extra: 1 }))
			)
		).resolves.toEqual({ status: 200, body: '{"name":"<b>"}' })
	})
})

// One sanitizer pass per string, the live JIT is the reference for each row.
// `&` also proves a route isn't passing through untouched
describe('frozen sanitize equals the live JIT', () => {
	const cases: [
		name: string,
		schema: () => any,
		input: unknown,
		expected: string
	][] = [
		[
			'a nested string',
			() => t.Object({ a: t.Object({ b: t.Object({ c: t.String() }) }) }),
			{ a: { b: { c: '&' } } },
			'{"a":{"b":{"c":"&amp;"}}}'
		],
		[
			'strings in an array of objects',
			() => t.Object({ a: t.Array(t.Object({ b: t.String() })) }),
			{ a: [{ b: '&' }, { b: '&&' }] },
			'{"a":[{"b":"&amp;"},{"b":"&amp;&amp;"}]}'
		],
		[
			'an optional string',
			() => t.Object({ a: t.Optional(t.String()) }),
			{ a: '&' },
			'{"a":"&amp;"}'
		],
		['a root string', () => t.String(), '&', '&amp;'],
		[
			'a union member',
			() => t.Object({ a: t.Union([t.String(), t.Number()]) }),
			{ a: '&' },
			'{"a":"&amp;"}'
		],
		[
			'a string inside a union of objects',
			() =>
				t.Object({
					a: t.Union([
						t.Object({ x: t.String() }),
						t.Object({ y: t.Number() })
					])
				}),
			{ a: { x: '&' } },
			'{"a":{"x":"&amp;"}}'
		],
		[
			'a string beside a codec',
			() => t.Object({ n: t.Numeric(), s: t.String() }),
			{ n: '1', s: '&' },
			'{"n":1,"s":"&amp;"}'
		],
		[
			'a string in a closed object',
			() => t.Object({ a: t.String() }, { additionalProperties: false }),
			{ a: '&' },
			'{"a":"&amp;"}'
		],
		[
			'a default',
			() => t.Object({ a: t.String({ default: '&' }), b: t.String() }),
			{ b: '&' },
			'{"a":"&amp;","b":"&amp;"}'
		],
		[
			'an ObjectString, once',
			() => t.Object({ o: t.ObjectString({ s: t.String() }) }),
			{ o: '{"s":"&"}' },
			'{"o":{"s":"&amp;"}}'
		],
		[
			'a nested ObjectString, once',
			() =>
				t.Object({
					o: t.ObjectString({
						i: t.ObjectString({ s: t.String() }),
						n: t.Numeric()
					})
				}),
			{ o: JSON.stringify({ i: '{"s":"&"}', n: '1' }) },
			'{"o":{"i":{"s":"&amp;"},"n":1}}'
		],
		[
			'an ArrayString of objects, once',
			() => t.Object({ o: t.ArrayString(t.Object({ s: t.String() })) }),
			{ o: '[{"s":"&"}]' },
			'{"o":[{"s":"&amp;"}]}'
		]
	]

	for (const [name, schema, input, expected] of cases)
		it(`sanitizes ${name}`, async () => {
			const build = bodyRoute(schema, escapeAmp)

			const live = await result(build(), post(input))
			expect(live).toEqual({ status: 200, body: expected })

			Validator.clear()

			await expect(
				frozenResult(build, () => post(input))
			).resolves.toEqual(live)
		})

	const query = () =>
		new Request('http://localhost/s?n=1&s=%26', { method: 'POST' })

	it('sanitizes a query with t.Numeric', async () => {
		const build = () =>
			new Elysia({ sanitize: escapeAmp }).post(
				'/s',
				{ query: t.Object({ n: t.Numeric(), s: t.String() }) },
				({ query }: any) => query
			)

		await expect(frozenResult(build, query)).resolves.toEqual({
			status: 200,
			body: '{"n":1,"s":"&amp;"}'
		})
	})

	it('sanitizes a query default for an absent key', async () => {
		const build = () =>
			new Elysia({ sanitize: escapeAmp }).post(
				'/s',
				{ query: t.Object({ s: t.String({ default: '&' }) }) },
				({ query }: any) => query
			)

		await expect(
			frozenResult(
				build,
				() => new Request('http://localhost/s', { method: 'POST' })
			)
		).resolves.toEqual({ status: 200, body: '{"s":"&amp;"}' })
	})

	const responses: [
		name: string,
		schema: () => any,
		value: unknown,
		expected: string
	][] = [
		[
			'a response object',
			() => t.Object({ s: t.String() }),
			{ s: '&' },
			'{"s":"&amp;"}'
		],
		['a root response string', () => t.String(), '&', '&amp;'],
		[
			'a response union',
			() => t.Object({ a: t.Union([t.String(), t.Number()]) }),
			{ a: '&' },
			'{"a":"&amp;"}'
		],
		[
			'a response beside a codec',
			() => t.Object({ n: t.Numeric(), s: t.String() }),
			{ n: 1, s: '&' },
			'{"n":1,"s":"&amp;"}'
		]
	]

	for (const [name, schema, value, expected] of responses)
		it(`sanitizes ${name}`, async () => {
			const build = () =>
				new Elysia({ sanitize: escapeAmp }).post(
					'/s',
					{ response: schema() },
					() => value as any
				)
			const request = () =>
				new Request('http://localhost/s', { method: 'POST' })

			const live = await result(build(), request())
			expect(live).toEqual({ status: 200, body: expected })

			Validator.clear()

			await expect(frozenResult(build, request)).resolves.toEqual(live)
		})
})

describe('frozen sanitize on a WebSocket', () => {
	it('sanitizes a message', async () => {
		const build = () =>
			new Elysia({ sanitize: escape }).use(websocket()).ws('/ws', {
				body: t.Object({ name: t.String() }),
				message(ws, message) {
					ws.send(message)
				}
			})

		await freeze(build)

		await withoutStringCode(async () => {
			const app = build().listen(0)
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const reply = wsMessage(ws)
			ws.send(JSON.stringify({ name: '<b>' }))

			expect((await reply).data).toBe('{"name":"&lt;b>"}')

			await wsClosed(ws)
			await app.stop(true)
		})
	})
})

describe('sealed sanitize', () => {
	const sealed = (
		hook: any,
		sanitize: unknown,
		run: (validator: any) => unknown
	) => {
		const { validators } = capture(() =>
			new Elysia({ sanitize } as any).post('/s', hook, () => 'x')
		)

		for (const validator of validators)
			expect(validator.bridgeFree).toBe(true)

		const claimed = claimManifest({ validators: materialise(validators) })

		return withoutStringCode(() => {
			const frozen = buildFrozenRouteValidator(
				hook,
				{ ...claimed, '~config': { sanitize }, '~ext': {} } as any,
				'POST',
				'/s'
			)
			expect(frozen).toBeDefined()

			return run(frozen)
		})
	}

	const body = t.Object({ name: t.String() })

	it('sanitizes with a lone function', async () => {
		await expect(
			sealed({ body }, escape, (v) => v.body.From({ name: '<b>' }))
		).resolves.toEqual({ name: '&lt;b>' })
	})

	it('runs an array of sanitizers in order', async () => {
		await expect(
			sealed(
				{ body },
				[(v: string) => v + '1', (v: string) => v + '2'],
				(v) => v.body.From({ name: 'x' })
			)
		).resolves.toEqual({ name: 'x12' })
	})

	it('reads an empty array as no sanitize', async () => {
		await expect(
			sealed({ body }, [], (v) => v.body.From({ name: '<b>', extra: 1 }))
		).resolves.toEqual({ name: '<b>' })
	})

	it('sanitizes a default for absent input', async () => {
		await expect(
			sealed(
				{
					body: t.Object(
						{ name: t.String() },
						{ default: { name: '<b>' } }
					)
				},
				escape,
				(v) => v.body.From(undefined)
			)
		).resolves.toEqual({ name: '&lt;b>' })
	})

	it('sanitizes beside a decode mirror', async () => {
		await expect(
			sealed(
				{ query: t.Object({ n: t.Numeric(), s: t.String() }) },
				escape,
				(v) => v.query.From({ n: '1', s: '<b>' })
			)
		).resolves.toEqual({ n: 1, s: '&lt;b>' })
	})

	it('sanitizes an ObjectString once', async () => {
		await expect(
			sealed(
				{ body: t.Object({ o: t.ObjectString({ s: t.String() }) }) },
				escapeAmp,
				(v) => v.body.From({ o: '{"s":"&"}' })
			)
		).resolves.toEqual({ o: { s: '&amp;' } })
	})

	it('sanitizes a response', async () => {
		await expect(
			sealed({ response: body }, escape, (v) =>
				v.response.get(200).EncodeFrom({ name: '<b>' })
			)
		).resolves.toEqual({ name: '&lt;b>' })
	})
})

// Sanitize is the one option Clean can't honor, so a failure here must never
// turn into unsanitized output
describe('a mirror that can not be built', () => {
	const silenced = async <T>(run: () => Promise<T>) => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		try {
			return await run()
		} finally {
			warn.mockRestore()
		}
	}

	it('fails the route when sanitize is set', async () => {
		const { status, body } = await withoutStringCode(() =>
			result(
				bodyRoute(() => t.Object({ name: t.String() }), escape)(),
				post({ name: '<b>' })
			)
		)

		expect(status).toBe(500)
		expect(body).toContain('Failed to compile route POST /s')
		expect(body).not.toContain('<b>')
	})

	it('degrades to TypeBox without sanitize', async () => {
		await expect(
			silenced(() =>
				withoutStringCode(() =>
					result(
						bodyRoute(
							() => t.Object({ name: t.String() }),
							undefined
						)(),
						post({ name: '<b>', extra: 1 })
					)
				)
			)
		).resolves.toEqual({ status: 200, body: '{"name":"<b>"}' })
	})

	// any configured `sanitize` is a hard requirement, as a missing exact-mirror
	it('fails with an empty sanitize array too', async () => {
		const { status, body } = await silenced(() =>
			withoutStringCode(() =>
				result(
					bodyRoute(() => t.Object({ name: t.String() }), [])(),
					post({ name: '<b>', extra: 1 })
				)
			)
		)

		expect(status).toBe(500)
		expect(body).toContain('Failed to compile route POST /s')
		expect(body).not.toContain('<b>')
	})

	for (const [name, schema, input] of [
		[
			'a union inside a Record',
			() =>
				t.Object({
					a: t.Record(t.String(), t.Union([t.String(), t.Number()]))
				}),
			{ a: { k: '<b>' } }
		],
		[
			'a union inside an Intersect',
			() =>
				t.Intersect([
					t.Object({ a: t.Union([t.String(), t.Number()]) }),
					t.Object({ b: t.String() })
				]),
			{ a: '<b>', b: 'x' }
		]
	] as const)
		it(`fails a slot refused capture for ${name}`, async () => {
			const build = bodyRoute(schema, escape)

			const body = capture(build).validators.find(
				(v) => v.slot === 'body'
			)
			expect(body?.mirror).toBeUndefined()

			const { status, body: text } = await silenced(() =>
				frozenResult(build, () => post(input))
			)

			expect(status).toBe(500)
			expect(text).toContain('Failed to compile route POST /s')
			expect(text).not.toContain('<b>')
		})

	const withEntry = (build: Build, edit: (entry: any) => void) => {
		const { handlers, validators } = capture(build)
		const manifest = materialise(validators)

		edit(manifest.POST!['/s']!.body)

		registerManifest({
			handlers: materialiseHandlers(handlers),
			validators: manifest
		})
	}

	it('rethrows from a lazy frozen mirror instead of passing through', async () => {
		const build = bodyRoute(() => t.Object({ name: t.String() }), escape)
		const { handlers, validators } = capture(build)

		for (const validator of validators) validator.checkValue = undefined

		const manifest = materialise(validators)
		manifest.POST!['/s']!.body!.m!.s = () => {
			throw new Error('broken mirror')
		}

		registerManifest({
			handlers: materialiseHandlers(handlers),
			validators: manifest
		})

		const { status, body } = await withoutStringCode(() =>
			result(build(), post({ name: '<b>' }))
		)

		expect(status).toBe(500)
		expect(body).not.toContain('<b>')
	})

	const numeric = () => t.Object({ n: t.Numeric(), s: t.String() })

	it('keeps sanitize through Clean when the decode mirror was refused', async () => {
		const build = bodyRoute(numeric, escape)

		withEntry(build, (entry) => {
			delete entry.dm
		})

		await expect(
			silenced(() =>
				withoutStringCode(() =>
					result(build(), post({ n: '1', s: '<b>' }))
				)
			)
		).resolves.toEqual({ status: 200, body: '{"n":1,"s":"&lt;b>"}' })
	})

	it('keeps sanitize through Clean when the decode mirror throws', async () => {
		const build = bodyRoute(numeric, escape)

		withEntry(build, (entry) => {
			entry.dm.s = () => {
				throw new Error('broken mirror')
			}
		})

		await expect(
			silenced(() =>
				withoutStringCode(() =>
					result(build(), post({ n: '1', s: '<b>' }))
				)
			)
		).resolves.toEqual({ status: 200, body: '{"n":1,"s":"&lt;b>"}' })
	})
})

// A sanitized `s` is a factory and an unsanitized one is the cleaner itself, so
// a manifest must never reach an app whose sanitize disagrees with its build
describe('a route whose sanitize drifted from the build', () => {
	const schema = () => t.Object({ name: t.String() })

	it('compiles live when the build sanitized and the app does not', async () => {
		await freeze(bodyRoute(schema, escape))

		await expect(
			result(bodyRoute(schema, undefined)(), post({ name: '<b>' }))
		).resolves.toEqual({ status: 200, body: '{"name":"<b>"}' })
	})

	it('compiles live when the app sanitizes and the build did not', async () => {
		await freeze(bodyRoute(schema, undefined))

		await expect(
			result(bodyRoute(schema, escape)(), post({ name: '<b>' }))
		).resolves.toEqual({ status: 200, body: '{"name":"&lt;b>"}' })
	})

	it('compiles live when the sanitizer count changed', async () => {
		await freeze(bodyRoute(schema, [escape]))

		await expect(
			result(
				bodyRoute(schema, [escape, escapeAmp])(),
				post({ name: '<b>' })
			)
		).resolves.toEqual({ status: 200, body: '{"name":"&amp;lt;b>"}' })
	})
})
