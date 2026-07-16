import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('route registry', () => {
	it('keeps lightweight declaration history without resolving duplicates', () => {
		const app = new Elysia()
			.get('/same', () => 'first')
			.get('/other', () => 'other')
			.get('/same', () => 'last')

		expect(app.history).toEqual([
			{ sequence: 0, method: 'GET', path: '/same' },
			{ sequence: 1, method: 'GET', path: '/other' },
			{ sequence: 2, method: 'GET', path: '/same' }
		])
		expect(Object.keys(app.history[0])).toEqual([
			'sequence',
			'method',
			'path'
		])
		expect(app['~routes'].map((route) => route[1])).toEqual([
			'/same',
			'/other',
			'/same'
		])
		expect(app.routes.map((route) => route.path)).toEqual([
			'/same',
			'/other',
			'/same'
		])
	})

	it('attributes absorbed routes to the immediate named plugin', () => {
		const plugin = new Elysia({ name: 'feature' }).get(
			'/feature',
			() => true
		)
		const app = new Elysia().use(plugin)

		expect(app.history).toEqual([
			{ sequence: 0, method: 'GET', path: '/feature', source: 'feature' }
		])
	})

	it('keeps old history snapshots frozen across late registration', () => {
		const app = new Elysia().get('/first', () => true)
		const first = app.history

		expect(Object.isFrozen(first)).toBeTrue()
		expect(Object.isFrozen(first[0])).toBeTrue()

		app.get('/late', () => true)

		expect(first).toEqual([{ sequence: 0, method: 'GET', path: '/first' }])
		expect(app.history).not.toBe(first)
		expect(app.history.map(({ path }) => path)).toEqual(['/first', '/late'])
	})

	it('attributes every absorbed declaration to its immediate plugin', () => {
		const child = new Elysia({ name: 'child' })
			.get('/first', () => 'first')
			.get('/second', () => 'second')
		const parent = new Elysia().use(child)

		expect(child.history).toHaveLength(2)
		expect(parent.history).toEqual([
			{ sequence: 0, method: 'GET', path: '/first', source: 'child' },
			{ sequence: 1, method: 'GET', path: '/second', source: 'child' }
		])
	})

	it('keeps exact declared path identities separate', () => {
		const app = new Elysia()
			.get('/x', () => 'plain')
			.get('/x/', () => 'slash')
			.get('/café', () => 'unicode')
			.get('/caf%C3%A9', () => 'encoded')

		expect(app['~routes'].map((route) => route[1])).toEqual([
			'/x',
			'/x/',
			'/café',
			'/caf%C3%A9'
		])
	})

	it('does not rebuild the projected route table for every dynamic route', () => {
		const app = new Elysia().macro({
			noop() {
				return {}
			}
		})
		for (let i = 0; i < 10; i++) app.get(`/${i}/:id`, () => true)

		const getRoutes = Object.getOwnPropertyDescriptor(
			Elysia.prototype,
			'~routes'
		)!.get!
		let reads = 0
		Object.defineProperty(app, '~routes', {
			get() {
				reads++
				return getRoutes.call(app)
			}
		})

		void app.fetch
		expect(reads).toBe(2)
	})
})
