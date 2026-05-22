import { Elysia } from '../../src'
import { parseQueryFromURL, parseQueryStandardSchema } from '../../src/parse-query'

import * as z from 'zod'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

const hasOwn = (value: unknown, key: string) =>
	Object.prototype.hasOwnProperty.call(value, key)

const proto = (key: string) =>
	encodeURIComponent(`{"${key}":{"polluted":"yes"}}`)

describe('Query Prototype Pollution', () => {
	it('strip dangerous keys from a parsed object query value', () => {
		const query = parseQueryStandardSchema(`filter=${proto('__proto__')}`)

		expect(typeof query.filter).toBe('object')
		expect(hasOwn(query.filter, '__proto__')).toBe(false)
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})

	it('strip dangerous keys from a parsed array query value', () => {
		const query = parseQueryStandardSchema(
			`filter=${encodeURIComponent('[{"__proto__":{"polluted":"yes"},"ok":1}]')}`
		)

		expect(Array.isArray(query.filter)).toBe(true)
		expect(hasOwn((query.filter as any)[0], '__proto__')).toBe(false)
		expect((query.filter as any)[0]).toEqual({ ok: 1 })
	})

	it('strip constructor and prototype keys', () => {
		const query = parseQueryStandardSchema(
			`filter=${encodeURIComponent('{"constructor":1,"prototype":2,"keep":3}')}`
		)

		expect(query.filter).toEqual({ keep: 3 })
	})

	it('preserve legitimate object and array query values', () => {
		const query = parseQueryStandardSchema(
			`obj=${encodeURIComponent('{"a":1,"b":["x","y"]}')}&list=${encodeURIComponent('[1,2,3]')}`
		)

		expect(query.obj).toEqual({ a: 1, b: ['x', 'y'] })
		expect(query.list).toEqual([1, 2, 3] as any)
	})

	it('strip dangerous keys in parseQueryFromURL object arrays', () => {
		const query = parseQueryFromURL(
			`arr=${encodeURIComponent('[{"__proto__":{"polluted":"yes"},"k":2}]')}`,
			0,
			{ arr: 1 },
			{ arr: 1 }
		)

		expect(hasOwn((query.arr as any)[0], '__proto__')).toBe(false)
		expect((query.arr as any)[0]).toEqual({ k: 2 } as any)
	})

	it('does not pollute the prototype through a standard schema query route', async () => {
		// A standard schema (Zod) query validator routes parsing through
		// parseQueryStandardSchema, which auto-parses JSON-looking values.
		const app = new Elysia().get('/', ({ query }) => query.filter, {
			query: z.object({
				filter: z.record(z.string(), z.unknown())
			})
		})

		const res = await app.handle(req(`/?filter=${proto('__proto__')}`))

		expect(res.status).toBe(200)
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})
})
