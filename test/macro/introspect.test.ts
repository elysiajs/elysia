import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, status, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileFromFrozenHandler } from '../aot/_manifest'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClosed } from '../ws/utils'
import { post } from '../utils'

const push = (log: string[], name: string) => () => {
	log.push(name)
}

// a macro whose hook must run after every other hook of the same event
const last = (log: string[], event = 'afterHandle') => {
	const mark = push(log, 'mark')

	return {
		[event]: mark,
		introspect(hooks: any) {
			const list: Function[] = Array.isArray(hooks[event])
				? hooks[event]
				: [hooks[event]]

			hooks[event] = [...list.filter((fn) => fn !== mark), mark]
		}
	}
}

describe('Macro introspect', () => {
	for (const [when, sees] of [
		['before', true],
		['after', false]
	] as const)
		it(`${sees ? 'sees' : 'does not see'} a parent afterHandle registered ${when} the child was used`, async () => {
			const log: string[] = []
			const parent = push(log, 'parent')
			let seen: Function[] = []
			const macro = last(log)
			const reorder = macro.introspect
			macro.introspect = (hooks: any) => {
				seen = [...hooks.afterHandle]
				reorder(hooks)
			}
			const child = new Elysia()
				.macro({ last: macro })
				.get('/', { last: true }, () => 'ok')
			const app =
				when === 'before'
					? new Elysia().afterHandle(parent).use(child)
					: new Elysia().use(child).afterHandle(parent)

			await app.handle('/')
			expect(seen.includes(parent)).toBe(sees)
			expect(log).toEqual(sees ? ['parent', 'mark'] : ['mark'])
		})

	it('sees a macro listed later on the route', async () => {
		const log: string[] = []
		const app = new Elysia()
			.macro({
				last: last(log),
				tag: { afterHandle: push(log, 'tag') }
			})
			.get('/', { last: true, tag: true }, () => 'ok')

		await app.handle('/')
		expect(log).toEqual(['tag', 'mark'])
	})

	it("sees the route's own afterHandle list", async () => {
		const log: string[] = []
		const app = new Elysia()
			.macro({ last: last(log) })
			.get(
				'/',
				{
					last: true,
					afterHandle: [push(log, 'a'), push(log, 'b')]
				},
				() => 'ok'
			)

		await app.handle('/')
		expect(log).toEqual(['a', 'b', 'mark'])
	})

	it('sees the global afterHandle a child route inherits', async () => {
		const log: string[] = []
		const inherited = push(log, 'inherited')
		let seen: Function[] = []
		const child = new Elysia()
			.macro({
				last: {
					...last(log),
					introspect(hooks: any) {
						seen = hooks.afterHandle
					}
				}
			})
			.get('/', { last: true }, () => 'ok')
		const app = new Elysia().afterHandle('global', inherited).use(child)

		await app.handle('/')
		expect(seen).toContain(inherited)
		expect(log).toEqual(['inherited', 'mark'])
	})

	it('runs each macro introspect once per route, in the order listed', async () => {
		const seen: string[] = []
		const app = new Elysia()
			.macro({
				a: {
					afterHandle: () => {},
					introspect: () => {
						seen.push('a')
					}
				},
				b: {
					afterHandle: () => {},
					introspect: () => {
						seen.push('b')
					}
				}
			})
			.get('/', { b: true, a: true }, () => 'ok')
			.get('/other', { a: true }, () => 'ok')

		await app.handle('/')
		await app.handle('/')
		await app.handle('/other')
		expect(seen).toEqual(['b', 'a', 'a'])
	})

	it('runs once for a guard, on the guard hooks shared by its routes', async () => {
		const log: string[] = []
		let calls = 0
		const macro = last(log)
		const app = new Elysia()
			.macro({
				last: {
					...macro,
					introspect(hooks: any) {
						calls++
						macro.introspect(hooks)
					}
				}
			})
			.guard({ last: true, afterHandle: push(log, 'guard') }, (app) =>
				app.get('/a', () => 'ok').get('/b', () => 'ok')
			)

		await app.handle('/a')
		await app.handle('/b')
		expect(calls).toBe(1)
		expect(log).toEqual(['guard', 'mark', 'guard', 'mark'])
	})

	it('strips a schema before validation', async () => {
		const body = t.Object({ name: t.String() })
		const app = new Elysia()
			.macro({
				loose: {
					body,
					introspect(hooks: any) {
						hooks.schemas = hooks.schemas.filter(
							(schema: { body?: unknown }) => schema.body !== body
						)
					}
				},
				strict: { body }
			})
			.post('/loose', { loose: true }, () => 'ok')
			.post('/strict', { strict: true }, () => 'ok')

		const send = (path: string) => app.handle(post(path, { other: 1 }))

		expect((await send('/loose')).status).toBe(200)
		expect((await send('/strict')).status).toBe(422)
	})

	describe('adding a status to the response map', () => {
		const add404 = {
			introspect(hooks: any) {
				hooks.response[404] = t.Number()
			}
		}

		// `/sibling` declares the same map without the macro
		const expectOwnRouteOnly = async (
			app: Elysia<any, any, any, any, any, any, any, any>
		) => {
			expect((await app.handle('/number')).status).toBe(404)
			expect((await app.handle('/string')).status).toBe(500)
			expect((await app.handle('/sibling')).status).toBe(404)
		}

		it("changes only its route's own map", async () => {
			const app = new Elysia()
				.macro({ add404 })
				.get(
					'/number',
					{ add404: true, response: { 200: t.String() } },
					() => status(404, 1) as any
				)
				.get(
					'/string',
					{ add404: true, response: { 200: t.String() } },
					() => status(404, 'a') as any
				)
				.get(
					'/sibling',
					{ response: { 200: t.String() } },
					() => status(404, 'a') as any
				)

			await expectOwnRouteOnly(app)
		})

		it('changes a guard map for its route only', async () => {
			const app = new Elysia()
				.macro({ add404 })
				.guard({ response: { 200: t.String() } }, (guard) =>
					guard
						.get(
							'/number',
							{ add404: true },
							() => status(404, 1) as any
						)
						.get(
							'/string',
							{ add404: true },
							() => status(404, 'a') as any
						)
						.get('/sibling', () => status(404, 'a') as any)
				)

			await expectOwnRouteOnly(app)
		})

		it('fills an empty map the route still owns', async () => {
			// an empty map is not shared or frozen, so a macro that adds the
			// first status keeps working as it did before maps were shared
			const app = new Elysia()
				.macro({
					add200: {
						introspect(hooks: any) {
							hooks.response[200] = t.String()
						}
					}
				})
				.get('/', { add200: true, response: {} }, () => 'ok')

			const response = await app.handle('/')
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('ok')
			expect(() => app.routes).not.toThrow()
		})
	})

	it('sees a macro listed later on a WebSocket route', async () => {
		const log: string[] = []
		const app = new Elysia()
			.macro({
				last: last(log, 'beforeHandle'),
				tag: { beforeHandle: push(log, 'tag') }
			})
			.use(websocket())
			.ws('/ws', {
				last: true,
				tag: true,
				message(ws) {
					ws.send('pong')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		await wsClosed(ws)
		app.stop()

		expect(log).toEqual(['tag', 'mark'])
	})

	describe('AOT', () => {
		afterEach(() => {
			Compiled.clear()
			Validator.clear()
		})

		const build = (log: string[]) => {
			const child = new Elysia()
				.macro({
					last: last(log),
					tag: { afterHandle: push(log, 'tag') }
				})
				.get('/', { last: true, tag: true }, () => 'ok')

			return new Elysia().afterHandle(push(log, 'parent')).use(child)
		}

		it('runs the reordered hooks from the reconstructed factory', async () => {
			const log: string[] = []
			const frozen = await compileFromFrozenHandler(() => build(log))

			await expect(
				frozen.handle('/').then((x) => x.text())
			).resolves.toBe('ok')
			expect(log).toEqual(['parent', 'tag', 'mark'])
		})
	})
})
