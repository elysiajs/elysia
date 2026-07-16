// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { clearSucroseCache, sucrose } from '../../src/sucrose'

const lifecycle = {
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
} as any

describe('isContextPassToFunction', () => {
	it('uses conservative inference above the source-size limit', () => {
		const padding = 'const _pad = ' + '"x".repeat(1);\n'.repeat(2200)

		const handler = new Function(
			'ctx',
			`${padding}\nreturn someHelper(ctx)`
		)

		const result = sucrose(handler, lifecycle)

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

	it('keeps narrow inference when the whole context is not passed', () => {
		const handler = ({ query }: any) => {
			return query.name
		}

		const result = sucrose(handler, lifecycle)

		expect(result.query).toBe(true)
		expect(result.headers).toBe(false)
		expect(result.body).toBe(false)
		expect(result.cookie).toBe(false)
		expect(result.set).toBe(false)
		expect(result.server).toBe(false)
	})

	it('analyzes a 300 KB handler within two seconds', () => {
		const padding = 'const _pad = ' + '"x".repeat(1);\n'.repeat(19000)

		const handler = new Function(
			'ctx',
			`${padding}\nreturn someHelper(ctx)`
		)

		const start = performance.now()

		sucrose(handler, lifecycle)

		const elapsed = performance.now() - start
		expect(elapsed).toBeLessThan(2000)
	})

	it('treats a dollar-prefixed context passed to a function conservatively', () => {
		clearSucroseCache(null)
		const handler = new Function('$ctx', 'return log($ctx)')

		const result = sucrose(handler, lifecycle)

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

	it('infers direct access through a dollar-prefixed context narrowly', () => {
		clearSucroseCache(null)
		const handler = new Function('$ctx', 'return $ctx.query.a')

		const result = sucrose(handler, lifecycle)

		expect(result.query).toBe(true)
		expect(result.body).toBe(false)
		expect(result.headers).toBe(false)
	})
})
