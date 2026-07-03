// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { sucrose } from '../../src/sucrose'

describe('isContextPassToFunction', () => {
	// (a) A handler body larger than the 32KB cap must yield the conservative inference
	// (all fields true) even though the handler body does not explicitly access every field.
	it('large body (>32KB) gets conservative all-true inference', () => {
		// Build a handler body that is well over 32*1024 bytes and references
		// the context parameter exactly once in a realistic way.
		const padding = 'const _pad = ' + '"x".repeat(1);\n'.repeat(2200)

		const handler = new Function(
			'ctx',
			`${padding}\nreturn someHelper(ctx)`
		)

		const result = sucrose(handler, {
			afterHandle: [],
			beforeHandle: [],
			error: [],
			mapResponse: [],
			afterResponse: [],
			parse: [],
			request: [],
			start: [],
			stop: [],
			trace: [],
			transform: []
		})

		// Conservative deopt: every field must be true
		expect(result.query).toBe(true)
		expect(result.headers).toBe(true)
		expect(result.body).toBe(true)
		expect(result.cookie).toBe(true)
		expect(result.set).toBe(true)
		expect(result.server).toBe(true)
		expect(result.url).toBe(true)
		expect(result.route).toBe(true)
		expect(result.path).toBe(true)
	})

	// (b) A small body that does NOT contain the context identifier is correctly
	// inferred as "not passed" — only the fields actually accessed are true.
	it('small body without context string is correctly inferred as not-passed', () => {
		// Handler only destructures query — context identifier is not passed anywhere
		const handler = ({ query }: any) => {
			return query.name
		}

		const result = sucrose(handler, {
			afterHandle: [],
			beforeHandle: [],
			error: [],
			mapResponse: [],
			afterResponse: [],
			parse: [],
			request: [],
			start: [],
			stop: [],
			trace: [],
			transform: []
		})

		expect(result.query).toBe(true)
		// Other fields must remain false — the context was not passed to a function
		expect(result.headers).toBe(false)
		expect(result.body).toBe(false)
		expect(result.cookie).toBe(false)
		expect(result.set).toBe(false)
		expect(result.server).toBe(false)
	})

	// (c) Loose timing guard: inferring a ~300KB synthetic body completes quickly
	it('inferring ~300KB handler body completes in under 2000ms', () => {
		const padding = 'const _pad = ' + '"x".repeat(1);\n'.repeat(19000)

		const handler = new Function(
			'ctx',
			`${padding}\nreturn someHelper(ctx)`
		)

		const start = performance.now()

		sucrose(handler, {
			afterHandle: [],
			beforeHandle: [],
			error: [],
			mapResponse: [],
			afterResponse: [],
			parse: [],
			request: [],
			start: [],
			stop: [],
			trace: [],
			transform: []
		})

		const elapsed = performance.now() - start
		expect(elapsed).toBeLessThan(2000)
	})
})
