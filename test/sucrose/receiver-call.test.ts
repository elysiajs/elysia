// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { sucrose } from '../../src/sucrose'

// A method called as `ctx.method()` receives the context as `this`, so it can
// read any channel the handler's own source never names. A derive or decorate
// method that reads `this.query` is invisible to the scan: the call
// itself is the only place the context reaches it.
const method = function (this: any) {
	return this.query?.name ?? 'miss'
}

const nameOf = async (app: Elysia) => {
	const response = await app.handle(new Request('http://e.ly/?name=hit'))
	expect(response.status).toBe(200)
	return response.text()
}

describe('context passed as the receiver of a method call', () => {
	it('keeps query for a derive method called on the context', async () => {
		const app = new Elysia()
			.derive(() => ({ consume: method }))
			.get('/', (ctx) => ctx.consume())

		expect(await nameOf(app)).toBe('hit')
	})

	it('keeps query for a derive method called on an alias', async () => {
		const app = new Elysia()
			.derive(() => ({ consume: method }))
			.get('/', (ctx) => {
				const c = ctx
				return c.consume()
			})

		expect(await nameOf(app)).toBe('hit')
	})

	it('keeps query for an optional method call', async () => {
		const app = new Elysia()
			.derive(() => ({ consume: method }))
			.get('/', (ctx) => ctx.consume?.())

		expect(await nameOf(app)).toBe('hit')
	})

	it('keeps query for a method called from a hook', async () => {
		let seen: string | undefined
		const app = new Elysia()
			.derive(() => ({ consume: method }))
			.get(
				'/',
				{
					beforeHandle(ctx) {
						seen = ctx.consume()
					}
				},
				() => 'ok'
			)

		await app.handle(new Request('http://e.ly/?name=hit'))
		expect(seen).toBe('hit')
	})
})

// Widening on every call would parse every channel for `ctx.status(404)` or
// `ws.send()`. Built-in members never read the context through `this`, so a
// call to one must keep the inference precise.
describe('built-in members called on the context stay precise', () => {
	const only = (key?: string) => ({
		query: false,
		headers: false,
		body: false,
		cookie: false,
		set: false,
		route: false,
		...(key ? { [key]: true } : {})
	})

	it('does not widen for status, redirect or problem', () => {
		expect(
			sucrose((ctx) => ctx.status(404, ctx.query.x), undefined)
		).toEqual(only('query'))
		expect(sucrose((ctx) => ctx.redirect('/'), undefined)).toEqual(only())
		expect(
			sucrose((ctx) => ctx.problem({ status: 400 }), undefined)
		).toEqual(only())
	})

	it('does not widen for WebSocket members', () => {
		expect(sucrose((ws) => ws.send(ws.query.x), undefined)).toEqual(
			only('query')
		)
		expect(
			sucrose((ws) => {
				ws.subscribe('room')
				ws.publish('room', 'hi')
				ws.close()
			}, undefined)
		).toEqual(only())
	})

	it('still reads a call on a channel member as that channel', () => {
		expect(sucrose((ctx) => ctx.body.at(0), undefined)).toEqual(
			only('body')
		)
	})
})
