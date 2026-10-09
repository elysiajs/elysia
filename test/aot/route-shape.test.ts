import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import type { AnyElysia } from '../../src/base'
import { routeShape } from '../../src/compile/handler'
import { replaceFunction } from '../../src/type/shared'

const fn = () => 'ok'
const plain = new Elysia()
const modeled = new Elysia({
	cookie: { secrets: 'k', sign: ['session'] },
	sanitize: (value: string) => value
}).model({
	User: t.Object({ name: t.String(), item: t.Ref('Item') }),
	Item: t.Object({ id: t.Number() }),
	Session: t.Cookie({ id: t.String() })
})

const hidden = Object.defineProperty({ type: 'string' }, 'note', {
	value: 1,
	enumerable: false
})
const standard = { '~standard': { version: 1, vendor: 'x', validate() {} } }
const cycle: Record<string, unknown> = { type: 'object' }
cycle.self = cycle
const accessor = {
	get default() {
		return 'x'
	}
}
class Schema {
	type = 'string'
}

// `k` is what an AOT manifest stores per route and replay compares: a change
// to the canonical UTF-16 sequence it hashes turns every replay of an existing
// build into a live compile. Expected values come from the string-building
// implementation, the streaming one must hash the identical sequence
const cases: [
	name: string,
	hook: object | undefined,
	handler: unknown,
	root: AnyElysia,
	k: number | undefined
][] = [
	['bare handler', undefined, fn, plain, 708445471],
	['static handlers', undefined, 'text', plain, 1686203086],
	['static response', undefined, new Response('x'), plain, 2870273514],
	[
		'escaped strings and lone surrogates',
		{
			body: t.Object({
				'a"b\\c\n': t.String({ default: 'x\u2028y\u2029z\u007f' }),
				'\ud800': t.String({ default: '\udc00 😀' }),
				'\u0000\u001f': t.Literal('é')
			})
		},
		fn,
		plain,
		1498400034
	],
	[
		'numbers and bigint',
		{
			query: {
				type: 'number',
				minimum: -0,
				maximum: 1e21,
				multipleOf: 1e-7,
				default: NaN,
				exclusiveMaximum: Infinity,
				exclusiveMinimum: -Infinity,
				big: 10n
			}
		},
		fn,
		plain,
		2231214907
	],
	[
		'prototype tags',
		{ headers: t.Object({ x: t.Optional(t.String()) }) },
		fn,
		plain,
		2287876387
	],
	['hidden key', { params: hidden }, fn, plain, 942068681],
	[
		// `Item` is only reached through `User`, while refs are being walked
		'models, refs and response map',
		{
			body: 'User',
			response: { 200: 'User', 404: t.String() },
			schemas: [{ query: t.Object({ page: t.Number() }) }]
		},
		fn,
		modeled,
		2307811573
	],
	[
		'cookie config',
		{
			cookie: t.Cookie(
				{ session: t.String() },
				{ sign: ['session'], secrets: 'k' }
			)
		},
		fn,
		modeled,
		2112391736
	],
	['cookie model', { cookie: 'Session' }, fn, modeled, 1123203985],
	[
		'repeated function aliases',
		{ beforeHandle: [fn, fn, async () => {}], afterHandle: fn },
		fn,
		plain,
		1422267767
	],
	// a WebSocket route hashes its composed hook without a handler
	[
		'websocket',
		{ body: t.Object({ message: t.String() }), beforeHandle: fn },
		undefined,
		plain,
		1706092772
	],
	[
		'null and Standard Schema',
		{ body: { default: null }, query: standard },
		fn,
		plain,
		3897152919
	],
	['promise handler', undefined, Promise.resolve('x'), plain, 677529800],
	['object handler', undefined, { a: 1 }, plain, 34742847],
	// what can't be hashed without running or guessing it never replays
	['accessor', { body: accessor }, fn, plain, undefined],
	['symbol', { body: { default: Symbol('x') } }, fn, plain, undefined],
	['cycle', { body: cycle }, fn, plain, undefined],
	['foreign prototype', { body: new Schema() }, fn, plain, undefined]
]

describe('routeShape', () => {
	for (const [name, hook, handler, root, k] of cases)
		it(`keeps k of ${name}`, () => {
			expect(routeShape(hook as any, handler, root)).toBe(k)
		})
})

// Validator compile replaces refine checks in place. An AOT build hashes after
// its compile, runtime before, so a `k` that sees the replacements never
// replays and a strip build 500s (#2012)
const date = new Date().toISOString()
const refined = t.Refine(t.String(), (v) => v.length > 0)
const compiles: [name: string, body: any, value: unknown, status: number][] = [
	[
		't.Partial with 2 t.Date',
		t.Partial(t.Object({ id: t.Number(), a: t.Date(), b: t.Date() })),
		{ id: 1, a: date, b: date },
		200
	],
	[
		't.Partial with a reused t.Refine',
		t.Partial(t.Object({ a: refined, b: refined })),
		{ a: 'a', b: 'b' },
		200
	],
	// a sync guard wraps an async check
	[
		'async t.Refine',
		t.Object({ a: t.Refine(t.String(), (async () => true) as any) }),
		{ a: 'a' },
		500
	]
]

describe('routeShape across validator compile', () => {
	for (const [name, body, value, status] of compiles)
		it(`keeps k of ${name}`, async () => {
			const k = routeShape({ body }, fn, plain)

			const response = await new Elysia().post('/', { body }, fn).handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(value)
				})
			)

			expect(response.status).toBe(status)
			expect(routeShape({ body }, fn, plain)).toBe(k)
		})
})

// a manifest may reconstruct through another elysia install's module copy
it('keeps k when another module copy replaces a check', async () => {
	const copy = await import('../../src/type/shared.ts' + '?copy')
	expect(copy.replaceFunction).not.toBe(replaceFunction)

	const object = t.ObjectString({ x: t.Number() })
	const body = t.Partial(t.Object({ a: object, b: object })) as any
	const k = routeShape({ body }, fn, plain)

	for (const key of ['a', 'b']) {
		const refinement = body.properties[key].anyOf[1]['~refine'][0]
		const check = () => true
		copy.replaceFunction(check, refinement.check)
		refinement.check = check
	}

	expect(routeShape({ body }, fn, plain)).toBe(k)
})
