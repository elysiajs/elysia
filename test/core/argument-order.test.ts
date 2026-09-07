import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

// Reject the 1.x argument order before it serves the schema as the response.
describe('1.x argument order', () => {
	const verbs = [
		'get',
		'post',
		'put',
		'patch',
		'delete',
		'options',
		'head',
		'all'
	] as const

	for (const verb of verbs)
		it(`.${verb}(path, handler, hook) throws naming the verb and path`, () => {
			expect(() =>
				(new Elysia() as any)[verb]('/swapped', () => 'hi', {
					query: t.Object({ name: t.String() })
				})
			).toThrow(
				`[Elysia] .${verb}('/swapped', handler, hook) is the 1.x order; Elysia 2 takes (path, hook, handler) — see the 2.0 migration guide`
			)
		})

	it('names the prefixed path', () => {
		expect(() =>
			(new Elysia({ prefix: '/api' }) as any).get(
				'/swapped',
				() => 'hi',
				{
					query: t.Object({ name: t.String() })
				}
			)
		).toThrow(`[Elysia] .get('/api/swapped', handler, hook)`)
	})

	it('.method(verb, path, handler, hook) throws too', () => {
		expect(() =>
			(new Elysia() as any).method('SEARCH', '/swapped', () => 'hi', {
				query: t.Object({ name: t.String() })
			})
		).toThrow(
			`[Elysia] .search('/swapped', handler, hook) is the 1.x order`
		)
	})

	it('would otherwise serve the schema as the response body', async () => {
		const app = new Elysia()

		expect(() =>
			(app as any).post('/user', () => 'created', {
				body: t.Object({ name: t.String() })
			})
		).toThrow('is the 1.x order')

		expect(app.routes.length).toBe(0)
	})

	describe('valid v2 forms are untouched', () => {
		it('(path, hook, handler)', async () => {
			const app = new Elysia().get(
				'/ok',
				{ query: t.Object({ name: t.String() }) },
				({ query }) => query.name
			)

			expect((await app.handle('/ok?name=a')).status).toBe(200)
			expect((await app.handle('/ok')).status).toBe(422)
		})

		it('(path, handler)', async () => {
			const app = new Elysia().get('/ok', () => 'hi')

			expect(await (await app.handle('/ok')).text()).toBe('hi')
		})

		// Hook-only routes remain valid.
		it('(path, hookOnly) still registers', async () => {
			const app = new Elysia().get('/schema', {
				query: t.Object({ name: t.String() })
			} as any)

			expect(app.routes.length).toBe(1)
		})

		// A callable hook is valid when it has hook properties.
		it('a callable hook followed by a handler passes', async () => {
			const callableHook = Object.assign(() => {}, {
				query: t.Object({ name: t.String() })
			})

			const app = new Elysia().get(
				'/callable',
				callableHook as any,
				({ query }: any) => query.name
			)

			expect((await app.handle('/callable?name=a')).status).toBe(200)
			expect((await app.handle('/callable')).status).toBe(422)
		})

		it('a callable hook followed by a static string handler passes', async () => {
			const app = (new Elysia() as any).get(
				'/x',
				Object.assign(() => {}, {
					beforeHandle() {}
				}),
				'ok'
			)

			expect(await (await app.handle('/x')).text()).toBe('ok')
		})

		it('a callable hook followed by a static object handler passes', async () => {
			const app = (new Elysia() as any).get(
				'/x',
				Object.assign(() => {}, {
					beforeHandle() {}
				}),
				{ hello: 'world' }
			)

			await expect((await app.handle('/x')).json()).resolves.toEqual({
				hello: 'world'
			})
		})

		it('a bare hook function followed by a hook-less static object passes', async () => {
			const app = (new Elysia() as any).get('/x', () => {}, {
				hello: 'world'
			})

			await expect((await app.handle('/x')).json()).resolves.toEqual({
				hello: 'world'
			})
		})

		for (const [label, third] of [
			['null', null],
			['undefined', undefined]
		] as const)
			it(`(path, fn, ${label}) passes`, () => {
				expect(() =>
					(new Elysia() as any).get('/x', () => 'hi', third)
				).not.toThrow()
			})

		// A documentation-only object is still a 1.x hook.
		it('still rejects a 1.x hook that only carries `detail`', () => {
			expect(() =>
				(new Elysia() as any).get('/x', () => 'hi', {
					detail: { summary: 'x' }
				})
			).toThrow('is the 1.x order')
		})

		it('a static (non-function) handler after a hook passes', async () => {
			const app = new Elysia().get(
				'/static',
				{ response: t.String() },
				'literal' as any
			)

			expect(await (await app.handle('/static')).text()).toBe('literal')
		})

		it('.ws(path, options) passes', async () => {
			const app = new Elysia().ws('/ws', {
				message() {}
			})

			expect(app.routes.length).toBe(1)
		})
	})
})
