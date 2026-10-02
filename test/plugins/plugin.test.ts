import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

const callbacks = () => ({
	wrap: (next: any) => next,
	setup: () => {},
	cleanup: () => {}
})

const registerCallbacks = (
	app: Elysia,
	handlers: ReturnType<typeof callbacks>
) => app.wrap(handlers.wrap).setup(handlers.setup).cleanup(handlers.cleanup)

describe('Plugin', () => {
	it('await async nested plugin', async () => {
		const yay = async () => {
			await Bun.sleep(2)

			return new Elysia({ name: 'yay' }).get('/yay', 'yay')
		}

		const wrapper = new Elysia({ name: 'wrapper' }).use(yay())

		const app = new Elysia().use(wrapper)

		await app.modules

		const response = await app.handle('/yay')

		expect(response.status).toBe(200)
	})

	it('use([...]) dispatches promise, functional, and instance plugins', async () => {
		const asyncPlugin = (async () => {
			await Bun.sleep(2)
			return new Elysia({ name: 'async' }).get('/async', 'async')
		})()
		const fnPlugin = (app: Elysia) => app.get('/fn', 'fn')
		const instancePlugin = new Elysia({ name: 'instance' }).get(
			'/instance',
			'instance'
		)

		const app = new Elysia()
			// The typed overload models only Elysia instance arrays.
			.use([asyncPlugin, fnPlugin, instancePlugin] as any)
			.get('/', 'root')

		await app.modules

		for (const path of ['/async', '/fn', '/instance', '/']) {
			const response = await app.handle(path)
			expect(response.status).toBe(200)
		}
	})

	it('preserves direct extension duplicates on first absorption', () => {
		const duplicate = callbacks()
		const plugin = registerCallbacks(
			registerCallbacks(new Elysia(), duplicate),
			duplicate
		)

		const fresh = new Elysia().use(plugin)['~ext']!
		expect(fresh.hoc).toEqual([duplicate.wrap, duplicate.wrap])
		expect(fresh.setup).toEqual([duplicate.setup, duplicate.setup])
		expect(fresh.cleanup).toEqual([duplicate.cleanup, duplicate.cleanup])

		const seed = callbacks()
		const seeded = registerCallbacks(new Elysia(), seed).use(plugin)[
			'~ext'
		]!
		expect(seeded.hoc).toEqual([seed.wrap, duplicate.wrap])
		expect(seeded.setup).toEqual([seed.setup, duplicate.setup])
		expect(seeded.cleanup).toEqual([seed.cleanup, duplicate.cleanup])

		const empty = new Elysia().setup([]).cleanup([]).use(plugin)['~ext']!
		expect(empty.hoc).toEqual([duplicate.wrap, duplicate.wrap])
		expect(empty.setup).toEqual([duplicate.setup])
		expect(empty.cleanup).toEqual([duplicate.cleanup])
	})

	it('indexes direct callback appends without deduplicating them', () => {
		const first = callbacks()
		const incoming = callbacks()
		const late = callbacks()
		const plugin = registerCallbacks(new Elysia(), incoming)
		const latePlugin = registerCallbacks(new Elysia(), late)
		const app = registerCallbacks(new Elysia(), first).use(plugin)

		registerCallbacks(app, incoming)
		registerCallbacks(app, late)
		app.use(plugin)
		app.use(latePlugin)

		const ext = app['~ext']!
		expect(ext.hoc).toEqual([
			first.wrap,
			incoming.wrap,
			incoming.wrap,
			late.wrap
		])
		expect(ext.setup).toEqual([
			first.setup,
			incoming.setup,
			incoming.setup,
			late.setup
		])
		expect(ext.cleanup).toEqual([
			first.cleanup,
			incoming.cleanup,
			incoming.cleanup,
			late.cleanup
		])
	})

	it('keeps diamond extension callbacks once in first-seen order', () => {
		const sharedCallbacks = callbacks()
		const leftCallbacks = callbacks()
		const rightCallbacks = callbacks()
		const shared = registerCallbacks(
			new Elysia({ name: 'shared-extension' }),
			sharedCallbacks
		)
		const left = registerCallbacks(
			new Elysia({ name: 'left-extension' }).use(shared),
			leftCallbacks
		)
		const right = registerCallbacks(
			new Elysia({ name: 'right-extension' }).use(shared),
			rightCallbacks
		)

		const ext = new Elysia().use(left).use(right)['~ext']!
		expect(ext.hoc).toEqual([
			sharedCallbacks.wrap,
			leftCallbacks.wrap,
			rightCallbacks.wrap
		])
		expect(ext.setup).toEqual([
			sharedCallbacks.setup,
			leftCallbacks.setup,
			rightCallbacks.setup
		])
		expect(ext.cleanup).toEqual([
			sharedCallbacks.cleanup,
			leftCallbacks.cleanup,
			rightCallbacks.cleanup
		])
	})

	it('rebuilds callback indexes for replacement arrays', () => {
		const a = callbacks()
		const b = callbacks()
		const c = callbacks()
		const bc = registerCallbacks(registerCallbacks(new Elysia(), b), c)
		const app = registerCallbacks(new Elysia(), a).use(bc)
		const ext = app['~ext']!

		ext.hoc = [a.wrap]
		ext.setup = [a.setup]
		ext.cleanup = [a.cleanup]
		app.use(bc)

		expect(ext.hoc).toEqual([a.wrap, b.wrap, c.wrap])
		expect(ext.setup).toEqual([a.setup, b.setup, c.setup])
		expect(ext.cleanup).toEqual([a.cleanup, b.cleanup, c.cleanup])
	})
})
