/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { autoHead } from '../../src/plugin/auto-head'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from '../ws/utils'

describe('Macro resolution isolation', () => {
	it('does not leak hooks between routes compiled in different orders', async () => {
		let one = 0
		let two = 0

		const app = new Elysia()
			.macro({
				one: { beforeHandle: [() => void one++] },
				two: { beforeHandle: [() => void two++] }
			})
			.get('/both', { one: true, two: true } as any, () => 'ok')
			.get('/only-one', { one: true } as any, () => 'ok')

		await app.handle('/both')
		one = two = 0
		await app.handle('/only-one')

		expect(one).toBe(1)
		expect(two).toBe(0)
	})

	it('resolves a shared-plugin derive macro per app', async () => {
		const plugin = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'alice' }) } })
			.get('/me', { withUser: true } as any, ({ user }: any) => user)

		const app1 = new Elysia().use(plugin)
		const app2 = new Elysia().use(plugin)

		const r1 = await app1.handle('/me').then((r) => r.text())
		const r2 = await app2.handle('/me').then((r) => r.text())

		expect(r1).toBe('alice')
		expect(r2).toBe('alice')
	})

	it('resolves a shared-plugin derive macro in reverse compile order', async () => {
		const plugin = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'mei' }) } })
			.get('/me', { withUser: true } as any, ({ user }: any) => user)

		const app1 = new Elysia().use(plugin)
		const app2 = new Elysia().use(plugin)

		const r2 = await app2.handle('/me').then((r) => r.text())
		const r1 = await app1.handle('/me').then((r) => r.text())

		expect(r1).toBe('mei')
		expect(r2).toBe('mei')
	})

	it('throws on a cross-plugin macro name collision', () => {
		const a = new Elysia({ name: 'a' }).macro({
			auth: { beforeHandle: () => {} }
		})
		const b = new Elysia({ name: 'b' }).macro({
			auth: { beforeHandle: () => {} }
		})

		expect(() => new Elysia().use(a).use(b)).toThrow(/Macro "auth"/)
	})

	it('does not throw when the same plugin instance is reused', () => {
		const shared = new Elysia({ name: 'shared' }).macro({
			tag: { beforeHandle: () => {} }
		})
		const mid = new Elysia({ name: 'mid' }).use(shared)

		expect(() => new Elysia().use(shared).use(mid)).not.toThrow()
	})

	it('keeps a guard macro after reading .routes before the first request', async () => {
		const app = new Elysia()
			.macro({
				auth: {
					beforeHandle: ({ set }: any) => {
						set.status = 401
						return 'unauthorized'
					}
				}
			})
			.guard({ auth: true } as any, (a) =>
				a.get('/secret', () => 'TOP SECRET')
			)

		void app.routes

		const r = await app.handle('/secret')
		expect(r.status).toBe(401)
	})

	it('never mutates the user-supplied hook object', async () => {
		const hook: any = { flag: true }
		const app = new Elysia()
			.macro({ flag: { beforeHandle: () => {} } })
			.get('/z', hook, () => 'ok')

		await app.handle('/z')

		expect(Object.keys(hook)).toEqual(['flag'])
	})

	it('resolves the same hook object per app when shared', async () => {
		let a = 0
		let b = 0
		const sharedHook: any = { flag: true }

		const appA = new Elysia().macro({
			flag: { beforeHandle: () => void a++ }
		})
		const appB = new Elysia().macro({
			flag: { beforeHandle: () => void b++ }
		})
		appA.get('/z', sharedHook, () => 'ok')
		appB.get('/z', sharedHook, () => 'ok')

		await appA.handle('/z')
		a = b = 0
		await appB.handle('/z')

		expect(b).toBe(1)
		expect(a).toBe(0)
	})

	it('resolves a shared-plugin chain macro per app', async () => {
		let a = 0
		let b = 0
		const plugin = new Elysia().guard({ mark: true } as any, (app) =>
			app.get('/g', () => 'ok')
		)
		const appA = new Elysia()
			.macro({ mark: { beforeHandle: () => void a++ } })
			.use(plugin)
		const appB = new Elysia()
			.macro({ mark: { beforeHandle: () => void b++ } })
			.use(plugin)

		await appA.handle('/g')
		a = b = 0
		await appB.handle('/g')

		expect(b).toBe(1)
		expect(a).toBe(0)
	})

	it('flattens macro hook arrays before route hooks in declaration order', async () => {
		const order: string[] = []
		const app = new Elysia()
			.macro({
				m: {
					beforeHandle: [
						() => void order.push('m1'),
						() => void order.push('m2')
					]
				}
			})
			.get(
				'/a',
				{
					m: true,
					beforeHandle: () => void order.push('route')
				} as any,
				() => 'ok'
			)

		const r = await app.handle('/a')

		expect(r.status).toBe(200)
		expect(order).toEqual(['m1', 'm2', 'route'])
	})

	it('never mutates macro definition arrays', async () => {
		const def = { beforeHandle: [() => {}] }
		const app = new Elysia()
			.macro({ m: def })
			.get('/a', { m: true } as any, () => 'ok')
			.get('/b', { m: true } as any, () => 'ok')

		await app.handle('/a')
		await app.handle('/b')

		expect(def.beforeHandle.length).toBe(1)
	})

	it('does not mutate an array-form derive when another macro is applied', async () => {
		const fnA = () => ({ a: 'A' })
		const fnB = () => ({ b: 'B' })
		const defA = { derive: [fnA] }

		const app = new Elysia()
			.macro({ a: defA as any, b: { derive: [fnB] } as any })
			.get('/both', { a: true, b: true } as any, ({ a, b }: any) => ({
				a: a ?? null,
				b: b ?? null
			}))
			.get('/only-a', { a: true } as any, ({ a, b }: any) => ({
				a: a ?? null,
				b: b ?? null
			}))

		await expect(
			app.handle('/both').then((r) => r.json())
		).resolves.toEqual({
			a: 'A',
			b: 'B'
		})
		const onlyA = await app.handle('/only-a').then((r) => r.json())

		expect(defA.derive.length).toBe(1)
		expect(onlyA).toEqual({ a: 'A', b: null })
	})

	it('resolves derive and beforeHandle macros on a WebSocket route', async () => {
		let gate = 0
		let derived: unknown

		const app = new Elysia()
			.macro({
				user: { derive: () => ({ user: 'alice' }) },
				auth: {
					beforeHandle: (ctx: any) => {
						gate++
						derived = ctx.user
					}
				}
			})
			.use(websocket())
			.ws('/ws', {
				user: true,
				auth: true,
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('ping')
		const { data } = await message

		expect(data).toBe('pong')
		expect(gate).toBeGreaterThan(0)
		expect(derived).toBe('alice')

		await wsClosed(ws)
		app.stop()
	})

	it('points unnamed-factory collisions at plugin naming', () => {
		const factory = () =>
			new Elysia().macro({ auth: { beforeHandle: () => {} } })

		expect(() => new Elysia().use(factory()).use(factory())).toThrowError
	})

	it('registers no routes from a plugin whose macro collision is caught', async () => {
		const a = new Elysia({ name: 'a' }).macro({
			auth: { beforeHandle: () => {} }
		})
		const b = new Elysia({ name: 'b' })
			.macro({ auth: { beforeHandle: () => {} } })
			.get('/b-only', () => 'b')

		const app = new Elysia().use(a)
		expect(() => app.use(b)).toThrow(/Macro "auth"/)

		const fixed = new Elysia({ name: 'b' })
			.macro({ authB: { beforeHandle: () => {} } })
			.get('/fixed-only', () => 'fixed')
		app.use(fixed)

		expect((await app.handle('/b-only')).status).toBe(404)
		await expect(
			app.handle('/fixed-only').then((r) => r.text())
		).resolves.toBe('fixed')
	})

	it('does not mutate user detail while merging macro detail', async () => {
		const hook: any = {
			auth: true,
			detail: { tags: ['mine'], summary: 'x' }
		}
		const app = new Elysia()
			.macro({ auth: { detail: { tags: ['auth'] } } as any })
			.get('/z', hook, () => 'ok')

		await app.handle('/z')
		expect(hook.detail.tags).toEqual(['mine'])

		void app.routes
		const first = app.routes.find((r) => r.path === '/z') as any
		void app.routes
		const second = app.routes.find((r) => r.path === '/z') as any

		expect(hook.detail.tags).toEqual(['mine'])
		expect(first.hooks.detail.tags).toEqual(['mine', 'auth'])
		expect(second.hooks.detail.tags).toEqual(['mine', 'auth'])
	})

	it('allows a macro override inside a group callback', async () => {
		let outer = 0
		let inner = 0

		const app = new Elysia()
			.macro({ auth: { beforeHandle: () => void outer++ } })
			.group('/admin', (a) =>
				(a as any)
					.macro({ auth: { beforeHandle: () => void inner++ } })
					.get('/x', { auth: true } as any, () => 'ok')
			)

		expect((await app.handle('/admin/x')).status).toBe(200)
		expect(inner).toBe(1)
		expect(outer).toBe(0)
	})

	it('allows a macro override inside a guard callback', () => {
		expect(() =>
			new Elysia()
				.macro({ auth: { beforeHandle: () => {} } })
				.guard({}, (a) =>
					(a as any)
						.macro({ auth: { beforeHandle: () => {} } })
						.get('/g', { auth: true } as any, () => 'ok')
				)
		).not.toThrow()
	})
})

describe('Macro derive behavior', () => {
	it('reusing a function as derive does not change its beforeHandle semantics', async () => {
		const guard = ({ headers }: any) =>
			headers.authorization === 'ok' ? undefined : 'blocked'

		new Elysia().derive(guard as any)

		const app = new Elysia().get(
			'/s',
			{ beforeHandle: guard } as any,
			() => 'SECRET'
		)

		await expect(app.handle('/s').then((r) => r.text())).resolves.toBe(
			'blocked'
		)
		await expect(
			app
				.handle(
					new Request('http://localhost/s', {
						headers: { authorization: 'ok' }
					})
				)
				.then((r) => r.text())
		).resolves.toBe('SECRET')
	})

	it('reusing a function as derive does not change its WebSocket beforeHandle semantics', async () => {
		const gate = () => new Response('no', { status: 401 })

		new Elysia().derive(gate as any)

		const app = new Elysia()
			.use(websocket())
			.ws('/gated', {
				beforeHandle: gate,
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.use(websocket())
			.ws('/open', {
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.listen(0)

		const ok = newWebsocket(app.server!, '/open')
		await wsOpen(ok)
		const message = wsMessage(ok)
		ok.send('ping')
		expect(String((await message).data)).toBe('pong')
		await wsClosed(ok)

		const blocked = newWebsocket(app.server!, '/gated')
		const outcome = await new Promise<'pong' | 'rejected'>((resolve) => {
			const timer = setTimeout(() => resolve('rejected'), 1500)
			blocked.onopen = () => blocked.send('ping')
			blocked.onmessage = () => {
				clearTimeout(timer)
				resolve('pong')
			}
			blocked.onclose = () => {
				clearTimeout(timer)
				resolve('rejected')
			}
			blocked.onerror = () => {
				clearTimeout(timer)
				resolve('rejected')
			}
		})
		blocked.close()
		expect(outcome).toBe('rejected')

		app.stop()
	})

	it('merges a derive result into context instead of returning it', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'alice' }))
			.get('/me', ({ user }: any) => `hi ${user}`)

		await expect(app.handle('/me').then((r) => r.text())).resolves.toBe(
			'hi alice'
		)
	})

	it('merges every function from array-form derive into context', async () => {
		const app = new Elysia()
			.derive([() => ({ a: 1 }), () => ({ b: 2 })] as any)
			.get('/d', ({ a, b }: any) => `a=${a},b=${b}`)

		await expect(app.handle('/d').then((r) => r.text())).resolves.toBe(
			'a=1,b=2'
		)
	})

	it('rejects a WebSocket upgrade when derive returns a status', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/gated', {
				derive: ({ status }: any) => status(401, 'no'),
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.use(websocket())
			.ws('/open', {
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.listen(0)

		const ok = newWebsocket(app.server!, '/open')
		await wsOpen(ok)
		const m = wsMessage(ok)
		ok.send('ping')
		expect(String((await m).data)).toBe('pong')
		await wsClosed(ok)

		const blocked = newWebsocket(app.server!, '/gated')
		const outcome = await new Promise<'pong' | 'rejected'>((resolve) => {
			const timer = setTimeout(() => resolve('rejected'), 1500)
			blocked.onopen = () => blocked.send('ping')
			blocked.onmessage = () => {
				clearTimeout(timer)
				resolve('pong')
			}
			blocked.onclose = () => {
				clearTimeout(timer)
				resolve('rejected')
			}
			blocked.onerror = () => {
				clearTimeout(timer)
				resolve('rejected')
			}
		})
		blocked.close()
		expect(outcome).toBe('rejected')

		app.stop()
	})

	it('flattens a macro derive array with a route-local derive', async () => {
		const app = new Elysia()
			.macro({
				authed: {
					derive: [() => ({ token: 'T' }), () => ({ uid: 7 })]
				} as any
			})
			.get(
				'/x',
				{ authed: true, derive: () => ({ rid: 'R' }) } as any,
				({ token, uid, rid }: any) => `${token}-${uid}-${rid}`
			)

		const r = await app.handle('/x')
		expect(r.status).toBe(200)
		await expect(r.text()).resolves.toBe('T-7-R')
	})

	it('runs both a guard macro derive and the guard own derive', async () => {
		let macroRan = false
		const app = new Elysia()
			.macro({
				auth: {
					derive: () => {
						macroRan = true
						return { user: 'alice', role: 'admin' }
					}
				} as any
			})
			.guard(
				{ auth: true, derive: () => ({ reqId: 'r1' }) } as any,
				(a) =>
					a.get(
						'/g',
						({ user, role, reqId }: any) =>
							`${user}-${role}-${reqId}`
					)
			)

		const r = await app.handle('/g')
		expect(r.status).toBe(200)
		await expect(r.text()).resolves.toBe('alice-admin-r1')
		expect(macroRan).toBe(true)
	})

	it('preserves macro derive order beside a route-local derive', async () => {
		const app = new Elysia()
			.macro({
				w: {
					derive: [
						() => ({ base: 10 }),
						({ base }: any) => ({ doubled: base * 2 })
					]
				} as any
			})
			.get(
				'/x',
				{ w: true, derive: [() => ({ tag: 'r' })] } as any,
				({ base, doubled, tag }: any) => `${base}-${doubled}-${tag}`
			)

		await expect(app.handle('/x').then((r) => r.text())).resolves.toBe(
			'10-20-r'
		)
	})

	it('runs a shared inherited derive once before its inheriting derives', async () => {
		const order: string[] = []
		const app = new Elysia()
			.macro({
				auth: {
					derive: () => {
						order.push('auth')

						return { user: { role: 'admin' } }
					}
				}
			})
			.macro({
				rbac: (roles: string[]) => ({
					auth: true,
					derive: ({ user }) => {
						order.push('rbac')

						return { allowed: roles.includes(user.role) }
					}
				}),
				rbac2: (roles: string[]) => ({
					auth: true,
					derive: ({ user }) => {
						order.push('rbac2')

						return { allowed2: roles.includes(user.role) }
					}
				})
			})
			.get(
				'/',
				{ rbac: ['admin'], rbac2: ['admin'] },
				({ allowed, allowed2 }) => allowed && allowed2
			)

		await expect(app.handle('/').then((r) => r.json())).resolves.toBe(true)
		expect(order).toEqual(['auth', 'rbac', 'rbac2'])
	})

	it('runs duplicate route hooks when a macro contributes to the same channel', async () => {
		let n = 0
		const f = () => {
			n++
		}
		const app = new Elysia()
			.macro({ m: { beforeHandle: () => {} } as any })
			.get('/x', { m: true, beforeHandle: [f, f] } as any, () => 'ok')

		await app.handle('/x')
		expect(n).toBe(2)
	})
})

describe('Scoped macro resolution', () => {
	it('does not leak macro schemas between apps sharing a plugin', async () => {
		const shared = new Elysia({ name: 'shared' })
			.guard({
				schema: 'merge',
				headers: t.Object({ 'x-h': t.String() }),
				tagged: true
			} as any)
			.get('/x', () => 'ok')

		const withQuery = new Elysia()
			.macro({
				tagged: (on: boolean) =>
					on ? { query: t.Object({ q: t.String() }) } : {}
			} as any)
			.use(shared)
		const noQuery = new Elysia()
			.macro({ tagged: () => ({}) } as any)
			.use(shared)

		const h = { headers: { 'x-h': 'v' } }
		expect(
			(await withQuery.handle(new Request('http://localhost/x', h)))
				.status
		).toBe(422)
		expect(
			(await noQuery.handle(new Request('http://localhost/x', h))).status
		).toBe(200)
	})

	it('scopes a group macro override to the group instead of sibling routes', async () => {
		const gate = {
			role: (need: string) => ({
				beforeHandle({ request, status }: any) {
					if (request.headers.get('x-role') !== need)
						return status(403, 'denied')
				}
			})
		}
		const H = (p: string, r?: string) =>
			new Request(
				'http://localhost' + p,
				r ? { headers: { 'x-role': r } } : {}
			)

		const app = new Elysia()
			.macro(gate as any)
			.get('/admin', { role: 'admin' } as any, () => 'A')
			.group('/docs', (a) =>
				(a as any)
					.macro({ role: () => ({ beforeHandle() {} }) })
					.get('/', { role: 'anyone' } as any, () => 'DOCS')
			)
			.get('/after', { role: 'admin' } as any, () => 'AFTER')

		expect((await app.handle(H('/docs/'))).status).toBe(200)
		expect((await app.handle(H('/admin'))).status).toBe(403)
		expect((await app.handle(H('/admin', 'admin'))).status).toBe(200)
		expect((await app.handle(H('/after'))).status).toBe(403)
	})

	it('scopes a guard-callback macro override to the guard', async () => {
		const gate = {
			role: (need: string) => ({
				beforeHandle({ request, status }: any) {
					if (request.headers.get('x-role') !== need)
						return status(403, 'denied')
				}
			})
		}
		const H = (p: string, r?: string) =>
			new Request(
				'http://localhost' + p,
				r ? { headers: { 'x-role': r } } : {}
			)

		const app = new Elysia()
			.macro(gate as any)
			.get('/x', { role: 'admin' } as any, () => 'X')
			.guard({}, (a) =>
				(a as any)
					.macro({ role: () => ({ beforeHandle() {} }) })
					.get('/open', { role: 'anyone' } as any, () => 'OPEN')
			)

		expect((await app.handle(H('/open'))).status).toBe(200)
		expect((await app.handle(H('/x'))).status).toBe(403)
	})

	it('applies a parent macro registered after a group is created', async () => {
		const H = (p: string) => new Request('http://localhost' + p)

		const app = new Elysia()
			.macro({ early: { beforeHandle() {} } })
			.group('/g', (g) =>
				(g as any).get('/x', { auth: true } as any, () => 'SECRET')
			)
			.macro({
				auth: {
					beforeHandle({ status }: any) {
						return status(401)
					}
				}
			})

		expect((await app.handle(H('/g/x'))).status).toBe(401)

		const app2 = new Elysia()
			.macro({ early: { beforeHandle() {} } })
			.get('/y', { auth: true } as any, () => 'SECRET')
			.group('/g', (g) =>
				(g as any).get('/x', { auth: true } as any, () => 'SECRET')
			)
			.macro({
				auth: {
					beforeHandle({ status }: any) {
						return status(401)
					}
				}
			})
		expect((await app2.handle(H('/y'))).status).toBe(401)
		expect((await app2.handle(H('/g/x'))).status).toBe(401)
	})

	it('uses a parent macro redefined after a group is created', async () => {
		const ran: string[] = []
		const app = new Elysia()
			.macro({ auth: { beforeHandle: () => void ran.push('old') } })
			.group('/g', (g) =>
				(g as any).get('/x', { auth: true } as any, () => 'ok')
			)
			.macro({ auth: { beforeHandle: () => void ran.push('new') } })

		await app.handle(new Request('http://localhost/g/x'))
		expect(ran).toEqual(['new'])
	})
})

describe('Macro derives across hook chains', () => {
	it('merges an app derive into a route that has its own hook', async () => {
		let handlerRan = false
		const app = new Elysia()
			.derive(() => ({ who: 'bob' }))
			.get('/', { beforeHandle() {} } as any, ({ who }: any) => {
				handlerRan = true
				return who
			})

		const r = await app.handle(new Request('http://localhost/'))
		await expect(r.text()).resolves.toBe('bob')
		expect(handlerRan).toBe(true)
	})

	it('merges every derive contributed by a hook chain', async () => {
		const app = new Elysia()
			.derive(() => ({ a: 1 }))
			.derive(() => ({ b: 2 }))
			.get(
				'/',
				{ beforeHandle() {} } as any,
				({ a, b }: any) => `${a}-${b}`
			)

		const r = await app.handle(new Request('http://localhost/'))
		await expect(r.text()).resolves.toBe('1-2')
	})
})

describe('Scoped macro resolution across registrations', () => {
	it('a guard inside a group honors the group macro override', async () => {
		const app = new Elysia()
			.macro({
				auth: () => ({
					beforeHandle({ request, status }: any) {
						if (!request.headers.get('x-user')) return status(401)
					}
				})
			})
			.group('/admin', (a: any) =>
				a
					.macro({
						auth: () => ({
							beforeHandle({ request, status }: any) {
								if (request.headers.get('x-user') !== 'admin')
									return status(403)
							}
						})
					})
					.guard({ auth: true } as any, (b: any) =>
						b.get('/panel', () => 'ADMIN PANEL')
					)
			)

		const r = await app.handle(
			new Request('http://localhost/admin/panel', {
				headers: { 'x-user': 'bob' }
			})
		)
		expect(r.status).toBe(403)
	})

	it('a plugin route inside a strengthened group honors the override', async () => {
		const secret = new Elysia().get(
			'/data',
			{ auth: true } as any,
			() => 'SECRET'
		)
		const app = new Elysia()
			.macro({ auth: () => ({ beforeHandle() {} }) } as any)
			.group('/admin', (g: any) =>
				g
					.macro({
						auth: () => ({
							beforeHandle: () =>
								new Response('FORBIDDEN', { status: 403 })
						})
					})
					.use(secret)
			)

		const r = await app.handle(new Request('http://localhost/admin/data'))
		expect(r.status).toBe(403)
	})

	it('a macro defined inside a group does not run on siblings', async () => {
		let ran: string[] = []
		const app = new Elysia()
			.get('/before', { tag: true } as any, () => 'before')
			.group('/g', (g: any) =>
				g
					.macro({
						tag: {
							beforeHandle() {
								ran.push('x')
							}
						}
					})
					.get('/inside', { tag: true } as any, () => 'inside')
			)
			.get('/after', { tag: true } as any, () => 'after')

		ran = []
		await app.handle(new Request('http://localhost/before'))
		expect(ran).toEqual([])

		ran = []
		await app.handle(new Request('http://localhost/after'))
		expect(ran).toEqual([])
	})

	it('lets a group override to an empty def disable the root macro in-group', async () => {
		const app = new Elysia()
			.macro({
				auth: () => ({
					beforeHandle: () => new Response('ROOT', { status: 401 })
				})
			})
			.group('/g', (g: any) =>
				g
					.macro({ auth: () => ({}) })
					.get('/x', { auth: true } as any, () => 'x')
					.guard({ auth: true } as any, (b: any) =>
						b.get('/y', () => 'y')
					)
			)
			.get('/out', { auth: true } as any, () => 'out')

		expect(
			(await app.handle(new Request('http://localhost/g/x'))).status
		).toBe(200)
		expect(
			(await app.handle(new Request('http://localhost/g/y'))).status
		).toBe(200)
		expect(
			(await app.handle(new Request('http://localhost/out'))).status
		).toBe(401)
	})
})

describe('Functional plugin macros', () => {
	it('throws on a cross-plugin macro name collision via functional plugins', () => {
		const pluginA = (app: any) =>
			app.macro({
				auth: {
					beforeHandle: () => new Response('A', { status: 401 })
				}
			})
		const pluginB = (app: any) => app.macro({ auth: { beforeHandle() {} } })

		expect(() => new Elysia().use(pluginA).use(pluginB)).toThrowError()
	})

	it('throws when a functional plugin defines a macro after an await', async () => {
		const pluginB = async (app: any) => {
			await Promise.resolve()
			app.macro({ auth: { beforeHandle() {} } })
			return app
		}

		const app = new Elysia()
			.use(pluginB)
			.get('/me', { auth: true } as any, () => 'ME')

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})
		expect(err as Error | undefined).toBeInstanceOf(Error)
	})

	it('fails loud instead of letting an async plugin silently override a gate', async () => {
		const pluginA = (app: any) =>
			app.macro({
				auth: {
					beforeHandle: () => new Response('A', { status: 401 })
				}
			})

		const pluginB = async (app: any) => {
			await Promise.resolve()
			app.macro({ auth: { beforeHandle() {} } })
			return app
		}

		const app = new Elysia()
			.use(pluginA)
			.use(pluginB)
			.get('/me', { auth: true } as any, () => 'ME')

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})
		expect(err).toBeInstanceOf(Error)
	})

	it('allows an async functional plugin to define a macro before its await', async () => {
		const pluginB = async (app: any) => {
			app.macro({ tag: { beforeHandle() {} } })
			await Promise.resolve()
			return app
		}

		const app = new Elysia()
			.use(pluginB)
			.get('/me', { tag: true } as any, () => 'ME')
		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('allows a sibling .macro() registered after use(autoHead())', async () => {
		const app = new Elysia()
			.use(autoHead())
			.macro({ tag: { beforeHandle() {} } })
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('allows a sibling sync plugin macro registered after an async functional plugin', async () => {
		const asyncPlugin = async (app: any) => {
			await Promise.resolve()
			return app
		}
		const macroPlugin = new Elysia().macro({ tag: { beforeHandle() {} } })

		const app = new Elysia()
			.use(asyncPlugin)
			.use(macroPlugin)
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('allows a sibling async plugin to define a pre-await macro while another async plugin is pending', async () => {
		const slow = async (app: any) => {
			await new Promise((resolve) => setTimeout(resolve, 10))
			return app
		}
		const fast = async (app: any) => {
			app.macro({ tag: { beforeHandle() {} } })
			await Promise.resolve()
			return app
		}

		const app = new Elysia()
			.use(slow)
			.use(fast)
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('names the offending macro when an async plugin registers one post-await', async () => {
		const app = new Elysia()
			.use(async (app: any) => {
				await Promise.resolve()
				app.macro({ evil: { beforeHandle() {} } })
				return app
			})
			.macro({ safe: { beforeHandle() {} } })

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})

		expect((err as Error | undefined)?.message).toBe(
			'Macro evil can only run in sync plugin'
		)
	})

	it('allows an async plugin resolving to a macro instance while a slower async sibling is pending', async () => {
		const lazy = new Elysia({ name: 'lazy-macro-a' }).macro({
			tag: { beforeHandle() {} }
		})

		const app = new Elysia()
			.use(async () => ({ default: lazy }))
			.use(async (app: any) => {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return app
			})
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('allows an async plugin resolving to a macro instance registered after a slower async sibling', async () => {
		const lazy = new Elysia({ name: 'lazy-macro-b' }).macro({
			tag: { beforeHandle() {} }
		})

		const app = new Elysia()
			.use(async (app: any) => {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return app
			})
			.use(async () => lazy)
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('allows a guard scope-child to absorb an async macro plugin while an async sibling is pending', async () => {
		const lazy = new Elysia({ name: 'lazy-macro-c' }).macro({
			tag: { beforeHandle() {} }
		})

		const app = new Elysia()
			.guard({} as any, (app: any) => app.use(async () => lazy))
			.use(async (app: any) => {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return app
			})

		await (app as any).modules
	})

	it('names the offending macro when an absorbed macro plugin shares the window', async () => {
		const lazy = new Elysia({ name: 'lazy-macro-d' }).macro({
			good: { beforeHandle() {} }
		})

		const app = new Elysia()
			.use(async () => lazy)
			.use(async (app: any) => {
				await new Promise((resolve) => setTimeout(resolve, 10))
				app.macro({ evil: { beforeHandle() {} } })
				return app
			})

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})

		expect((err as Error | undefined)?.message).toBe(
			'Macro evil can only run in sync plugin'
		)
	})

	it('absorbs a plugin resolved from a synchronously-resolving custom thenable', async () => {
		const lazy = new Elysia({ name: 'sync-thenable-lazy' })
			.macro({ tag: { beforeHandle() {} } })
			.get('/lazy', () => 'LAZY')

		const app = new Elysia()
			.use(() => ({
				// a sync-invoking then whose return value is undefined:
				// direct .then chaining would drop the resolved plugin
				then(onFulfilled: (value: unknown) => void) {
					onFulfilled(lazy)
				}
			}))
			.get('/me', { tag: true } as any, () => 'ME')

		await (app as any).modules

		expect(
			(await app.handle(new Request('http://localhost/lazy'))).status
		).toBe(200)
		expect(
			(await app.handle(new Request('http://localhost/me'))).status
		).toBe(200)
	})

	it('names the offending macro when a sync thenable registers one inside its own then', async () => {
		const app = new Elysia().use((app: any) => ({
			// then runs as an async continuation (after the snapshot
			// microtask), so this registration must still be blamed.
			// Also pins that thenable guard errors surface through the
			// async modules rejection lane, not a synchronous throw
			then(onFulfilled: (value: unknown) => void) {
				app.macro({ evil: { beforeHandle() {} } })
				onFulfilled(app)
			}
		}))

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})

		expect((err as Error | undefined)?.message).toBe(
			'Macro evil can only run in sync plugin'
		)
	})

	it('surfaces a synchronously-rejecting thenable plugin through modules', async () => {
		const app = new Elysia().use(() => ({
			then(
				_onFulfilled: (value: unknown) => void,
				onRejected: (err: unknown) => void
			) {
				onRejected(new Error('sync thenable boom'))
			}
		}))

		let err: unknown
		await (app as any).modules.catch((e: unknown) => {
			err = e
		})

		expect((err as Error | undefined)?.message).toBe('sync thenable boom')
	})
})

describe('Scoped macro resolution after composition', () => {
	it('sees a parent macro registered after a group whose callback defined its own macro', async () => {
		const app = new Elysia()
			.group('/g', (g: any) =>
				g
					.macro({ log: { beforeHandle() {} } })
					.get('/x', { secure: true } as any, () => 'X')
			)
			.macro({
				secure: {
					beforeHandle: () => new Response('BLOCKED', { status: 401 })
				}
			} as any)

		const guardForm = new Elysia()
			.guard({}, (app) =>
				app
					.macro({ log: { beforeHandle() {} } })
					.get('/y', { secure: true } as any, () => 'Y')
			)
			.macro({
				secure: {
					beforeHandle: () => new Response('BLOCKED', { status: 401 })
				}
			} as any)

		expect((await app.handle('/g/x')).status).toBe(401)
		expect((await guardForm.handle('/y')).status).toBe(401)
	})

	it('applies a consumer app macro to a plugin-internal group route', async () => {
		const ran: string[] = []
		const plugin = new Elysia()
			.macro({
				pmacro: { beforeHandle: () => void ran.push('p') }
			} as any)
			.group('/p', (g: any) =>
				g.get('/data', { rootMacro: true } as any, () => 'DATA')
			)

		const app = new Elysia()
			.macro({
				rootMacro: {
					beforeHandle: () => {
						ran.push('root')
						return new Response('BLOCKED', { status: 401 })
					}
				}
			} as any)
			.use(plugin)

		const r = await app.handle('/p/data')
		expect(r.status).toBe(401)
		expect(ran).toEqual(['root'])
	})

	it('allows a named plugin factory diamond across features', async () => {
		const setup = () =>
			new Elysia({ name: 'setup' }).macro({
				auth: {
					beforeHandle: () => new Response('AUTH', { status: 401 })
				}
			} as any)

		const userRoutes = new Elysia({ name: 'user' })
			.use(setup())
			.get('/me', { auth: true } as any, () => 'me')
		const postRoutes = new Elysia({ name: 'post' })
			.use(setup())
			.get('/posts', { auth: true } as any, () => 'posts')

		const app = new Elysia().use(userRoutes).use(postRoutes)

		expect((await app.handle('/me')).status).toBe(401)
		expect((await app.handle('/posts')).status).toBe(401)

		const unnamed = () =>
			new Elysia().macro({ auth: { beforeHandle() {} } } as any)
		expect(() => new Elysia().use(unnamed()).use(unnamed())).toThrowError()
	})

	it('applies a macro registered on a used plugin after routes were read', async () => {
		const ran: string[] = []
		const plugin = new Elysia({ name: 'late-macro-plugin' })
			.macro({ dummy: { beforeHandle() {} } } as any)
			.group('/g', (g: any) =>
				g.guard({ late: true } as any).get('/x', () => 'OK')
			)

		const app = new Elysia().use(plugin)
		void app.routes
		plugin.macro({
			late: {
				beforeHandle: () => {
					ran.push('late')
					return new Response('BLOCKED', { status: 401 })
				}
			}
		} as any)

		const r = await app.handle('/g/x')
		expect(r.status).toBe(401)
		expect(ran).toEqual(['late'])
	})

	it('does not mutate a non-plain detail leaf while merging macro detail', async () => {
		class Meta {
			tags = ['user']
		}
		const meta = new Meta()

		const app = new Elysia()
			.macro({
				doc: { detail: { meta: { tags: ['macro'] } } }
			} as any)
			.get('/', { doc: true, detail: { meta } } as any, () => 'ok')

		void app.routes
		void app.routes
		void app['~routes']

		expect(meta.tags).toEqual(['user'])
		expect(Object.keys(meta)).toEqual(['tags'])
	})

	it('allows a functional plugin to refine its own macro with author last-wins', async () => {
		const H = (p: string) => new Request('http://localhost' + p)

		const plugin = (app: any) =>
			app
				.macro({ auth: { beforeHandle() {} } })
				.macro({
					auth: {
						beforeHandle: ({ status }: any) => status(401)
					}
				})
				.get('/p', { auth: true } as any, () => 'P')
		const app = new Elysia().use(plugin)
		expect((await app.handle(H('/p'))).status).toBe(401)

		const app2 = new Elysia()
			.macro({ auth: { beforeHandle() {} } })
			.macro({ auth: { beforeHandle: ({ status }: any) => status(403) } })
			.get('/a', { auth: true } as any, () => 'A')
		expect((await app2.handle(H('/a'))).status).toBe(403)
	})

	it('applies a macro defined after .routes introspection', async () => {
		const app = new Elysia().guard({ auth: true } as any, (a) =>
			a.get('/secret', () => 'secret')
		)

		void app.routes

		app.macro({
			auth: {
				beforeHandle: ({ set }: any) => {
					set.status = 401
					return 'no'
				}
			}
		})

		const r = await app.handle('/secret')
		expect(r.status).toBe(401)
	})

	it('applies a group macro override to HTTP and WebSocket routes', async () => {
		const app = new Elysia()
			.macro({ auth: { beforeHandle() {} } })
			.group('/g', (g) =>
				(g as any)
					.macro({
						auth: {
							beforeHandle({ status }: any) {
								return status(403)
							}
						}
					})
					.get('/h', { auth: true } as any, () => 'HTTP')
					.use(websocket())
					.ws('/ws', { auth: true, message() {} } as any)
			)
			.listen(0)

		expect((await app.handle('/g/h')).status).toBe(403)

		const ws = newWebsocket(app.server!, '/g/ws')
		const opened = await new Promise<boolean>((resolve) => {
			ws.onopen = () => resolve(true)
			ws.onerror = () => resolve(false)
			ws.onclose = () => resolve(false)
		})
		try {
			ws.close()
		} catch {}
		app.stop()

		expect(opened).toBe(false)
	})
})
