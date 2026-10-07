import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import type { AnyElysia } from '../../src/base'
import { routeShape } from '../../src/compile/handler'

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
