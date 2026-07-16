// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { sucrose } from '../../src/sucrose'
import { req } from '../utils'

const allContextProperties = {
	query: true,
	headers: true,
	body: true,
	cookie: true,
	set: true,
	server: true,
	path: true,
	url: true,
	route: true
}

const queryOnly = {
	query: true,
	headers: false,
	body: false,
	cookie: false,
	set: false,
	server: false,
	path: false,
	url: false,
	route: false
}

const responseText = async (handler: any, name: string) => {
	const response = await new Elysia()
		.get('/', handler)
		.handle(req(`/?name=${name}`))

	expect(response.status).toBe(200)
	return response.text()
}

describe('context access that cannot be statically identified', () => {
	it('keeps query available through a computed key', async () => {
		const handler = (context: any) => {
			const key = ['q', 'uery'].join('')
			return context[key].name
		}

		expect(await responseText(handler, 'computed')).toBe('computed')
	})

	it('keeps query available through a global key', async () => {
		;(globalThis as any).__sucroseContextKey = 'query'
		const handler = (context: any) =>
			context[(globalThis as any).__sucroseContextKey].name

		expect(await responseText(handler, 'global')).toBe('global')
		delete (globalThis as any).__sucroseContextKey
	})

	it('keeps query available after spreading the context', async () => {
		const handler = (context: any) => {
			const copy = { ...context }
			return copy.query.name
		}

		expect(await responseText(handler, 'spread')).toBe('spread')
	})

	it('keeps query available through arguments[0]', async () => {
		const handler = function (context: any) {
			return arguments[0].query.name
		}

		expect(await responseText(handler, 'arguments')).toBe('arguments')
	})

	it('keeps query available with whitespace before the dot', async () => {
		const handler = eval('(context) => context .query.name')

		expect(await responseText(handler, 'before-dot')).toBe('before-dot')
	})

	it('keeps query available with whitespace after the dot', async () => {
		const handler = eval('(context) => context.  query.name')

		expect(await responseText(handler, 'after-dot')).toBe('after-dot')
	})

	it('marks every context property as accessed', () => {
		expect(
			sucrose(function (context: any) {
				return arguments[0].query.name
			}, undefined)
		).toEqual(allContextProperties)

		expect(
			sucrose((context: any) => {
				const key = ['q', 'uery'].join('')
				return context[key].name
			}, undefined)
		).toEqual(allContextProperties)
	})
})

describe('context access that can be statically identified', () => {
	it('infers only query for direct member access', () => {
		expect(sucrose((context: any) => context.query.a, undefined)).toEqual(
			queryOnly
		)
	})

	it('infers only query for a computed query property', () => {
		expect(
			sucrose((context: any) => {
				const key = 'a'
				return context.query[key]
			}, undefined)
		).toEqual(queryOnly)
	})

	it('analyzes a 30 KB handler within 500 ms', () => {
		const filler = 'g('.repeat(15000)
		const handler = new Function(
			'context',
			`var s=${JSON.stringify(filler)}; return context.query.a`
		) as any
		expect(handler.toString().length).toBeGreaterThan(29000)
		expect(handler.toString().length).toBeLessThan(32768)

		const start = performance.now()
		const result = sucrose(handler, undefined)

		expect(performance.now() - start).toBeLessThan(500)
		expect(result.query).toBe(true)
		expect(result.body).toBe(false)
	})
})
