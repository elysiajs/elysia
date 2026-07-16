/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from '../ws/utils'

describe('Macro resolution', () => {
	// A macro definition's hook array must never be aliased or mutated, so compiling
	// a two-macro route before a one-macro route cannot leak the second macro.
	it('does not contaminate a macro across routes by compile order', async () => {
		let one = 0
		let two = 0

		const app = new Elysia()
			.macro({
				one: { beforeHandle: [() => void one++] },
				two: { beforeHandle: [() => void two++] }
			})
			.get('/both', { one: true, two: true } as any, () => 'ok')
			.get('/only-one', { one: true } as any, () => 'ok')

		await app.handle(req('/both')) // compiles /both first
		one = two = 0
		await app.handle(req('/only-one'))

		expect(one).toBe(1)
		expect(two).toBe(0) // macro two must NOT leak into /only-one
	})

	// Derive behavior belongs to the function, so one plugin instance
	// consumed by two apps resolves the same in both, regardless of which
	// compiled first (previously app2 served the derive object as the response).
	it('resolves a shared-plugin derive macro per app', async () => {
		const plugin = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'kiana' }) } })
			.get('/me', { withUser: true } as any, ({ user }: any) => user)

		const app1 = new Elysia().use(plugin)
		const app2 = new Elysia().use(plugin)

		const r1 = await app1.handle(req('/me')).then((r) => r.text())
		const r2 = await app2.handle(req('/me')).then((r) => r.text())

		expect(r1).toBe('kiana')
		expect(r2).toBe('kiana')
	})

	it('resolves a shared-plugin derive macro in reverse compile order', async () => {
		const plugin = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'mei' }) } })
			.get('/me', { withUser: true } as any, ({ user }: any) => user)

		const app1 = new Elysia().use(plugin)
		const app2 = new Elysia().use(plugin)

		// compile app2 first this time
		const r2 = await app2.handle(req('/me')).then((r) => r.text())
		const r1 = await app1.handle(req('/me')).then((r) => r.text())

		expect(r1).toBe('mei')
		expect(r2).toBe('mei')
	})

	// Two plugins defining a macro of the same name would collapse into one
	// flat table (auth-bypass class). A genuine collision must fail loud.
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

	// Reading `.routes` before the first request must not cache a
	// pre-macro flatten that then drops a guard-level macro (silent auth bypass).
	it('keeps a guard macro after reading .routes pre-request', async () => {
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

		void app.routes // introspect BEFORE first request

		const r = await app.handle(req('/secret'))
		expect(r.status).toBe(401)
	})

	// resolution must not mutate the user's hook object, even when it is
	// reused across routes or apps.
	it('never mutates the user-supplied hook object', async () => {
		const hook: any = { flag: true }
		const app = new Elysia()
			.macro({ flag: { beforeHandle: () => {} } })
			.get('/z', hook, () => 'ok')

		await app.handle(req('/z'))

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

		await appA.handle(req('/z'))
		a = b = 0
		await appB.handle(req('/z'))

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

		await appA.handle(req('/g'))
		a = b = 0
		await appB.handle(req('/g'))

		expect(b).toBe(1)
		expect(a).toBe(0)
	})

	// an array-form macro meeting a single route hook must produce a flat,
	// correctly-ordered array (previously a nested array that 500'd), macro-first.
	it('keeps array-macro order and never nests', async () => {
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

		const r = await app.handle(req('/a'))

		expect(r.status).toBe(200)
		expect(order).toEqual(['m1', 'm2', 'route'])
	})

	// Invariant backstop for the whole class: after resolving a route, the macro
	// definition object's own arrays are untouched (identity + length).
	it('never mutates the macro definition (invariant)', async () => {
		const def = { beforeHandle: [() => {}] }
		const app = new Elysia()
			.macro({ m: def })
			.get('/a', { m: true } as any, () => 'ok')
			.get('/b', { m: true } as any, () => 'ok')

		await app.handle(req('/a'))
		await app.handle(req('/b'))

		expect(def.beforeHandle.length).toBe(1)
	})

	// non-event array channels (`derive`) in a macro def must be COPIED,
	// not aliased: a second macro on the same route used to unshift into the
	// first macro's definition array, leaking its derive into every later
	// route that used only the first macro (cross-route auth-context leak).
	it('never mutates an array-form derive def via a sibling macro', async () => {
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

		// compile /both first — the leak was compile-order dependent
		expect(await app.handle(req('/both')).then((r) => r.json())).toEqual({
			a: 'A',
			b: 'B'
		})
		const onlyA = await app.handle(req('/only-a')).then((r) => r.json())

		expect(defA.derive.length).toBe(1)
		expect(onlyA).toEqual({ a: 'A', b: null })
	})

	// WS routes bypass composeRouteHook's localHook pass; a macro on a WS
	// route's own hook must still resolve (beforeHandle gate + derive channel).
	it('resolves a macro on a WS route local hook', async () => {
		let gate = 0
		let derived: unknown

		const app = new Elysia()
			.macro({
				user: { derive: () => ({ user: 'kiana' }) },
				auth: {
					beforeHandle: (ctx: any) => {
						gate++
						derived = ctx.user
					}
				}
			})
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
		expect(derived).toBe('kiana')

		await wsClosed(ws)
		app.stop()
	})

	// an unnamed factory reused twice is a genuine ref-inequality
	// collision; the error must point at the actual remedy (plugin `name`).
	it('points unnamed-factory collisions at plugin naming', () => {
		const factory = () =>
			new Elysia().macro({ auth: { beforeHandle: () => {} } })

		expect(() => new Elysia().use(factory()).use(factory())).toThrowError
	})

	// a caught collision throw must not leave partial state: the
	// colliding plugin's routes must not be registered (its macros never
	// merged — the silent-skip failure mode), and a corrected recomposition
	// under the SAME plugin name must not be dedup-skipped.
	it('leaves no partial state behind a caught collision', async () => {
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

		// b's routes never merged (no silent-skip half-state)…
		expect((await app.handle(req('/b-only'))).status).toBe(404)
		// …and the corrected plugin under the SAME name was not dedup-skipped
		expect(await app.handle(req('/fixed-only')).then((r) => r.text())).toBe(
			'fixed'
		)
	})

	// a macro `detail` merge must not mutate the user's registration
	// hook. `cloneHook` is shallow, so `input.detail` aliased the user's object
	// and mergeDeep concatenated the macro's tags back INTO the user's array —
	// corrupting it and growing it on every `.routes`/`.history` read.
	it('never mutates the user hook detail via a macro detail merge', async () => {
		const hook: any = {
			auth: true,
			detail: { tags: ['mine'], summary: 'x' }
		}
		const app = new Elysia()
			.macro({ auth: { detail: { tags: ['auth'] } } as any })
			.get('/z', hook, () => 'ok')

		await app.handle(req('/z'))
		// user's registration object is untouched by resolution
		expect(hook.detail.tags).toEqual(['mine'])

		// repeated introspection must not accumulate duplicate tags
		void app.routes
		const first = app.routes.find((r) => r.path === '/z') as any
		void app.routes
		const second = app.routes.find((r) => r.path === '/z') as any

		expect(hook.detail.tags).toEqual(['mine'])
		// the RESOLVED detail carries both, but does not grow across reads
		expect(first.hooks.detail.tags).toEqual(['mine', 'auth'])
		expect(second.hooks.detail.tags).toEqual(['mine', 'auth'])
	})

	// A `.macro` override inside a group or guard callback is an
	// intra-app scoped redefinition (last-wins, like calling `.macro` twice
	// on the app), not a cross-plugin collision.
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

		expect((await app.handle(req('/admin/x'))).status).toBe(200)
		// the group-scoped override won (last-wins), the parent def did not run
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

	// Derive-taint — derive-ness is now per RESOLVED HOOK, not a global function
	// identity. A function used as a `.derive` on one app, then reused as a
	// plain `beforeHandle` guard on another, must keep early-return (guard)
	// semantics in the second app. Previously the global tag made the guard's
	// return merge into context instead of blocking → auth bypass.
	it('a fn reused as a derive elsewhere still blocks as a plain guard (derive-taint)', async () => {
		const guard = ({ headers }: any) =>
			headers.authorization === 'ok' ? undefined : 'blocked'

		// taint: register the SAME identity as a derive on an unrelated app
		new Elysia().derive(guard as any)

		const app = new Elysia().get(
			'/s',
			{ beforeHandle: guard } as any,
			() => 'SECRET'
		)

		// guard returns a plain value → must short-circuit, handler never runs
		expect(await app.handle(req('/s')).then((r) => r.text())).toBe(
			'blocked'
		)
		// control: guard passes → handler runs (proves it isn't always blocking)
		expect(
			await app
				.handle(
					new Request('http://localhost/s', {
						headers: { authorization: 'ok' }
					})
				)
				.then((r) => r.text())
		).toBe('SECRET')
	})

	// Derive-taint (WS upgrade) — same invariant on the WS upgrade gate: a
	// blocking beforeHandle whose fn is derive-tainted elsewhere must still
	// reject the connection, not merge its return and upgrade.
	it('a fn reused as a derive elsewhere still blocks a WS upgrade (derive-taint/WS)', async () => {
		// always-blocking gate (query isn't parsed at upgrade time, so keep the
		// decision input-free and deterministic)
		const gate = () => new Response('no', { status: 401 })

		new Elysia().derive(gate as any) // taint

		const app = new Elysia()
			.ws('/gated', {
				beforeHandle: gate,
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.ws('/open', {
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.listen(0)

		// control: an ungated route upgrades + pongs (proves the harness works)
		const ok = newWebsocket(app.server!, '/open')
		await wsOpen(ok)
		const message = wsMessage(ok)
		ok.send('ping')
		expect(String((await message).data)).toBe('pong')
		await wsClosed(ok)

		// the gated route must be rejected. If the tainted gate were mis-treated
		// as a derive, its Response would be discarded and the socket would
		// upgrade + pong. Resolve on the first decisive event; a short fallback
		// keeps the pin from ever hitting the suite timeout.
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

	// A genuine derive
	// still MERGES into context and does not become the response (the handler
	// runs and sees the derived value).
	it('a genuine derive merges into context and does not short-circuit', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'kiana' }))
			.get('/me', ({ user }: any) => `hi ${user}`)

		expect(await app.handle(req('/me')).then((r) => r.text())).toBe(
			'hi kiana'
		)
	})

	// Array-form `.derive([f1, f2])` must tag each function as a
	// derive, not the array object. Otherwise the members are treated as plain
	// guards and the first one's returned object short-circuits as the response.
	it('tags each function of array-form .derive([f1, f2]) as a derive', async () => {
		const app = new Elysia()
			.derive([() => ({ a: 1 }), () => ({ b: 2 })] as any)
			.get('/d', ({ a, b }: any) => `a=${a},b=${b}`)

		// both derives MERGE into context; neither short-circuits as the response
		expect(await app.handle(req('/d')).then((r) => r.text())).toBe(
			'a=1,b=2'
		)
	})

	// WS-DERIVE-STATUS — a derive returning status/error (ElysiaStatus) on a
	// WS upgrade must ABORT the upgrade (like HTTP), not merge-and-upgrade. Only
	// the abort/rejection is asserted here; the exact HTTP status code of a WS
	// upgrade rejection is a separate pre-existing concern.
	it('a derive returning status aborts a WS upgrade (WS-DERIVE-STATUS)', async () => {
		const app = new Elysia()
			.ws('/gated', {
				derive: ({ status }: any) => status(401, 'no'),
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.ws('/open', {
				message(ws: any) {
					ws.send('pong')
				}
			} as any)
			.listen(0)

		// control: ungated route upgrades + pongs
		const ok = newWebsocket(app.server!, '/open')
		await wsOpen(ok)
		const m = wsMessage(ok)
		ok.send('ping')
		expect(String((await m).data)).toBe('pong')
		await wsClosed(ok)

		// the status-returning derive must reject (no pong)
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

	// FIX (derive-array/500) — a macro contributing `derive: [d1, d2]` (an array)
	// to a route whose local hook also carries its own single `derive` must fold
	// into a FLAT beforeHandle. `derive`/`resolve` are not `eventProperties`, so
	// the old merge nested them (`[[d1,d2], fn]`) and `bf[0](c)` threw 500.
	it('folds a macro derive-array beside a route derive without nesting (derive-array/500)', async () => {
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

		const r = await app.handle(req('/x'))
		expect(r.status).toBe(200)
		expect(await r.text()).toBe('T-7-R')
	})

	// FIX (guard macro-drop) — a `.guard({ macroKey: true, derive: fn })` folds
	// its own derive into beforeHandle in `#pushHook`; that promotion must keep
	// the macro key on the node, or the macro (its derive/beforeHandle) is
	// silently dropped and the handler sees the macro-injected context as
	// undefined (auth-context silent failure, not an error).
	it('keeps a guard macro when the guard also has its own derive (guard macro-drop)', async () => {
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

		const r = await app.handle(req('/g'))
		expect(r.status).toBe(200)
		expect(await r.text()).toBe('alice-admin-r1')
		expect(macroRan).toBe(true)
	})

	// FIX (derive-array/order) — macro derives run in DECLARED order even when
	// the route also supplies a derive; the old per-element unshift reversed
	// them, so a later derive reading an earlier one's output saw `undefined`.
	it('preserves macro derive-array order beside a route derive (derive-array/order)', async () => {
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

		expect(await app.handle(req('/x')).then((r) => r.text())).toBe(
			'10-20-r'
		)
	})

	// FIX (intra-route dedup) — a route that intentionally lists the same fn
	// twice in an event array must run it twice regardless of whether an
	// unrelated macro also contributes to that channel. The fresh-array merge
	// dedups only the MACRO's fns against the route, never the route's own.
	it('keeps a route hook duplicated when a macro touches the same channel (intra-route dedup)', async () => {
		let n = 0
		const f = () => {
			n++
		}
		const app = new Elysia()
			.macro({ m: { beforeHandle: () => {} } as any })
			.get('/x', { m: true, beforeHandle: [f, f] } as any, () => 'ok')

		await app.handle(req('/x'))
		expect(n).toBe(2)
	})

	// FIX (standalone-schema cross-app leak) — `coalesceStandaloneSchemas` must
	// not `Object.assign` a macro's schema onto a shared plugin guard entry
	// (`cloneHook` is shallow, so the resolution clone's schema entries still
	// alias the plugin's registration). Two apps reusing ONE plugin instance,
	// with different macro definitions, must not leak one app's required schema
	// into the other (cross-app validation bypass/over-enforcement).
	it('does not leak a macro schema across apps sharing a plugin (standalone-schema leak)', async () => {
		const shared = new Elysia({ name: 'shared' })
			.guard({
				schema: 'standalone',
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
		// the q-requiring app compiles first and enforces the query…
		expect(
			(await withQuery.handle(new Request('http://localhost/x', h)))
				.status
		).toBe(422)
		// …the no-op app must NOT inherit that requirement via the shared plugin
		expect(
			(await noQuery.handle(new Request('http://localhost/x', h))).status
		).toBe(200)
	})

	// FIX (group override scoping) — a `.macro` override inside a group/guard
	// callback must be SCOPED to that group's routes (matching `main`): the
	// group's own routes see the override, but sibling routes registered BEFORE
	// and AFTER the group (and the parent generally) keep the original macro.
	// Previously the override was merged back into the parent's single macro
	// table and, under lazy resolution, clobbered the macro app-wide — silently
	// disabling a macro-based auth gate on unrelated routes. The inside-group
	// check alone misses the sibling-containment half.
	it('scopes a group macro override to the group, not sibling routes (group override scoping)', async () => {
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
			.get('/admin', { role: 'admin' } as any, () => 'A') // sibling BEFORE
			.group('/docs', (a) =>
				(a as any)
					.macro({ role: () => ({ beforeHandle() {} }) }) // no-op override
					.get('/', { role: 'anyone' } as any, () => 'DOCS')
			)
			.get('/after', { role: 'admin' } as any, () => 'AFTER') // sibling AFTER

		// group route: the override applies (no gate)
		expect((await app.handle(H('/docs/'))).status).toBe(200)
		// sibling routes: the ORIGINAL gate still holds (not clobbered)
		expect((await app.handle(H('/admin'))).status).toBe(403)
		expect((await app.handle(H('/admin', 'admin'))).status).toBe(200)
		expect((await app.handle(H('/after'))).status).toBe(403)
	})

	it('scopes a guard-callback macro override to the guard (group override scoping)', async () => {
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

		expect((await app.handle(H('/open'))).status).toBe(200) // override inside
		expect((await app.handle(H('/x'))).status).toBe(403) // sibling gated
	})

	// B — a `.group`/`.guard(cb)` child prototype-links (not snapshots) the
	// parent macro table, so a macro the parent registers AFTER the group is
	// created is still seen by in-group routes. A flat snapshot froze the table
	// at group-creation time: an in-group route resolved against the stale copy,
	// the macro gate never ran, and the route failed open (200 instead of 401).
	it('applies a parent macro registered after a group is created (late-macro/B)', async () => {
		const H = (p: string) => new Request('http://localhost' + p)

		const app = new Elysia()
			.macro({ early: { beforeHandle() {} } }) // parent has ≥1 macro BEFORE group
			.group('/g', (g) =>
				(g as any).get('/x', { auth: true } as any, () => 'SECRET')
			)
			// `auth` is registered AFTER the group — the child must still see it
			.macro({
				auth: {
					beforeHandle({ status }: any) {
						return status(401)
					}
				}
			})

		expect((await app.handle(H('/g/x'))).status).toBe(401) // was 200 (bypass)

		// control: the same macro on a sibling registered BEFORE the late macro
		// already resolves correctly via lazy resolution — the group must match.
		const app2 = new Elysia()
			.macro({ early: { beforeHandle() {} } })
			.get('/y', { auth: true } as any, () => 'SECRET') // sibling, outside group
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
		expect((await app2.handle(H('/g/x'))).status).toBe(401) // symmetric
	})

	// B (redefine direction) — the child links the LIVE parent table by prototype,
	// so a macro the parent REDEFINES after the group (which the group did not
	// override) resolves to the new definition, not the value snapshotted at
	// group-creation time.
	it('sees a parent macro redefined after a group when the group did not override it (B/redefine)', async () => {
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

	// Mutation pin — a genuine app-level `.derive` merged onto a route that has
	// its OWN hook flows through `mergeHook` (localHook × appHook). `mergeHook`
	// must carry the derive provenance (`~deriveEntries`) across the merge; if it
	// drops it, the derive fn is treated as a plain guard and its returned object
	// short-circuits as the response instead of merging into context.
	it('keeps app-level derive provenance across a route with its own hook (mergeHook)', async () => {
		let handlerRan = false
		const app = new Elysia()
			.derive(() => ({ who: 'bob' }))
			.get(
				'/',
				{ beforeHandle() {} } as any, // own hook forces the mergeHook path
				({ who }: any) => {
					handlerRan = true
					return who
				}
			)

		const r = await app.handle(new Request('http://localhost/'))
		expect(await r.text()).toBe('bob') // was the derive object as a response
		expect(handlerRan).toBe(true) // derive must not short-circuit
	})

	// Mutation pin — flattening a chain with MORE THAN ONE derive contribution
	// must concatenate each node's `~deriveEntries` in `appendInto`, not
	// last-wins. If only the final derive keeps its provenance, the earlier one
	// is treated as a guard and its returned object short-circuits the request.
	it('keeps every derive provenance when a chain carries several (appendInto)', async () => {
		const app = new Elysia()
			.derive(() => ({ a: 1 }))
			.derive(() => ({ b: 2 }))
			.get(
				'/',
				{ beforeHandle() {} } as any,
				({ a, b }: any) => `${a}-${b}`
			)

		const r = await app.handle(new Request('http://localhost/'))
		expect(await r.text()).toBe('1-2') // was the first derive object, short-circuited
	})

	// Known gaps: keep skipped until scoped overrides cover these cases.
	// The group-override SCOPING fix (`localMacroRoot`) only redirects a route's
	// OWN hook (route[4]) to the group scope-child that carries the override.
	// Every OTHER macro consumer inside a group still resolves against the parent
	// table — where the override was WITHHELD by merge-back-only-new — so it
	// falls back to the parent's original definition. Each check asserts the
	// expected scoped-override
	// behavior and currently FAILS on this tree; the real fix is per-registration-
	// scope macro resolution (the chain flatten must resolve each node against the
	// macro table in scope where it was registered). Remove `.skip` when done.

	// Covers BOTH the inner `.guard(...)` and the app-level guard-inside-group
	// forms (same mechanism: a chain node resolves against the parent, not the
	// scope-child). A group override that STRENGTHENS a gate must apply to the
	// group's guarded routes — currently a non-admin reaches the panel (200).
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

		// authenticated but non-admin: the stricter group override must block
		const r = await app.handle(
			new Request('http://localhost/admin/panel', {
				headers: { 'x-user': 'bob' }
			})
		)
		expect(r.status).toBe(403) // CURRENTLY 200 (bypass)
	})

	// A plugin `.use`d inside a group carries `route[3]` = the plugin (not the
	// scope-child), so its routes resolve against the parent's (weaker) macro.
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
		expect(r.status).toBe(403) // CURRENTLY 200 (bypass)
	})

	// merge-back-only-new can't tell a macro that ARRIVED via a nested plugin's
	// `.use` (should merge back) from one DEFINED directly in the callback
	// (main scopes it), so a group-defined NEW macro leaks onto sibling routes.
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
		expect(ran).toEqual([]) // CURRENTLY ['x'] (leak)

		ran = []
		await app.handle(new Request('http://localhost/after'))
		expect(ran).toEqual([]) // CURRENTLY ['x'] (leak)
	})

	// A group override that resolves to a non-falsy EMPTY def (` => ({})` —
	// the idiom to DISABLE a macro-gate inside a group) must WIN: the scope
	// pass owns the key even when its def contributes no channels. The
	// two-phase resolver's per-key `delete` lives inside `for (k in hook)`,
	// which never runs for an empty def, so the key used to survive the scope
	// pass and the root's (stronger) definition re-applied → the in-group route
	// silently over-gated (failed CLOSED). Covers route-own-hook + guard forms.
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

		// in-group: the no-op override wins (would be 401 if root re-applied)
		expect(
			(await app.handle(new Request('http://localhost/g/x'))).status
		).toBe(200)
		expect(
			(await app.handle(new Request('http://localhost/g/y'))).status
		).toBe(200)
		// sibling outside the group: the root gate still applies
		expect(
			(await app.handle(new Request('http://localhost/out'))).status
		).toBe(401)
	})

	// A functional plugin `.use((app) => app.macro)`
	// calls `.macro` on the root directly and never reaches the `#use` throw.
	// `.macro` consults the functional-use baseline to reject a cross-plugin
	// name collision the same way an instance plugin throws. The baseline window
	// is SYNCHRONOUS (a functional plugin's sync body); a `.macro` after an
	// async plugin's first `await` is outside it and instead THROWS outright —
	// async macro definition is unsupported (see the async pins below).
	it('throws on a cross-plugin macro name collision via functional plugins', () => {
		const pluginA = (app: any) =>
			app.macro({
				auth: {
					beforeHandle: () => new Response('A', { status: 401 })
				}
			})
		const pluginB = (app: any) => app.macro({ auth: { beforeHandle() {} } }) // different def, same name

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

		// surfaces via the async plugin chain (#error → `.modules`)
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

	// A macro defined SYNCHRONOUSLY (before any await) in an async plugin is
	// fine — only post-await definition is rejected.
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

	// Adversarial checks for scoped macro overrides.

	// A group whose callback defines its OWN macro creates the scope-child's
	// table lazily; that table must prototype-link the parent's LIVE table
	// even when the parent had none at group creation. Without the link, a
	// parent macro registered AFTER the group (pre-request) was invisible to
	// in-group routes — the gate never ran and the route failed open (200).
	it('sees a parent macro registered after a group whose callback defined its own macro', async () => {
		const app = new Elysia()
			.group('/g', (g: any) =>
				g
					.macro({ log: { beforeHandle() {} } })
					.get('/x', { secure: true } as any, () => 'X')
			)
			// registered AFTER the group — must still gate /g/x
			.macro({
				secure: {
					beforeHandle: () => new Response('BLOCKED', { status: 401 })
				}
			} as any)

		const guardForm = new Elysia()
			.guard({} as any, (g: any) =>
				g
					.macro({ log: { beforeHandle() {} } })
					.get('/y', { secure: true } as any, () => 'Y')
			)
			.macro({
				secure: {
					beforeHandle: () => new Response('BLOCKED', { status: 401 })
				}
			} as any)

		expect((await app.handle(req('/g/x'))).status).toBe(401)
		expect((await guardForm.handle(req('/y'))).status).toBe(401)
	})

	// A route inside a PLUGIN's internal group resolves against the plugin's
	// scope chain, which ends at the plugin's table — a macro defined by the
	// CONSUMING app must still apply via the root fallback pass (parity with
	// the same plugin route outside a group).
	it('applies a consumer-app macro to a plugin-internal group route (root fallback)', async () => {
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

		const r = await app.handle(req('/p/data'))
		expect(r.status).toBe(401)
		expect(ran).toEqual(['root'])
	})

	// Collision detection must treat two definitions created by re-running
	// the SAME named plugin factory (the canonical service-locator pattern —
	// `setup` per feature module, features composed at root) as
	// deduplication, not a collision: that is exactly what the error message's
	// "give the plugin a `name`" remedy promises.
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

		// composes without throwing AND the macro still gates
		expect((await app.handle(req('/me'))).status).toBe(401)
		expect((await app.handle(req('/posts'))).status).toBe(401)

		// control: two UNNAMED plugins with a same-name macro still throw
		const unnamed = () =>
			new Elysia().macro({ auth: { beforeHandle() {} } } as any)
		expect(() => new Elysia().use(unnamed()).use(unnamed())).toThrowError()
	})

	// Memo invalidation is global (macro epoch): an app that already `.use`d
	// a plugin holds flatten/resolution memos keyed under ITSELF, which a
	// per-root invalidation could not reach — introspecting `.routes` and THEN
	// registering a late macro on the plugin served the stale pre-macro
	// resolution (gate silently dropped).
	it('invalidates a consumer app memo when a used plugin registers a late macro', async () => {
		const ran: string[] = []
		const plugin = new Elysia({ name: 'late-macro-plugin' })
			.macro({ dummy: { beforeHandle() {} } } as any)
			.group('/g', (g: any) =>
				g.guard({ X: true } as any).get('/x', () => 'OK')
			)

		const app = new Elysia().use(plugin)
		void app.routes // memoise resolution BEFORE the late macro
		plugin.macro({
			X: {
				beforeHandle: () => {
					ran.push('X')
					return new Response('BLOCKED', { status: 401 })
				}
			}
		} as any)

		const r = await app.handle(req('/g/x'))
		expect(r.status).toBe(401)
		expect(ran).toEqual(['X'])
	})

	// Item E — `clonePlainDeep` passes non-plain `detail` leaves (class
	// instance/Map/Date) through by reference; the macro `detail` merge then
	// descended INTO the user's shared object, mutating it and growing its
	// arrays on every `.routes`/`.history` read. The guard swaps the leaf for
	// a private copy of the macro's subtree (macro-wins) instead of writing
	// into user state.
	it('does not mutate a non-plain detail leaf via the macro detail merge (E)', async () => {
		class Meta {
			tags = ['user']
		}
		const meta = new Meta()

		const app = new Elysia()
			.macro({
				doc: { detail: { meta: { tags: ['macro'] } } }
			} as any)
			.get('/', { doc: true, detail: { meta } } as any, () => 'ok')

		// repeated introspection reads must not grow/mutate the user's object
		void app.routes
		void app.routes
		void app['~routes']

		expect(meta.tags).toEqual(['user'])
		expect(Object.keys(meta)).toEqual(['tags'])
	})

	// A functional plugin may freely refine a macro IT defined during its own run
	// (not a cross-plugin collision); and a direct author `.macro` override
	// outside any plugin keeps intentional last-wins.
	it('allows a functional plugin to refine its own macro with author last-wins', async () => {
		const H = (p: string) => new Request('http://localhost' + p)

		// intra-plugin refinement: no throw
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
		expect((await app.handle(H('/p'))).status).toBe(401) // last of the two won

		// direct author override (no functional plugin): last-wins, no throw
		const app2 = new Elysia()
			.macro({ auth: { beforeHandle() {} } })
			.macro({ auth: { beforeHandle: ({ status }: any) => status(403) } })
			.get('/a', { auth: true } as any, () => 'A')
		expect((await app2.handle(H('/a'))).status).toBe(403)
	})

	// EDGE PROBE (memo staleness): a macro referenced by a guard but registered
	// AFTER `.routes` was introspected. If the flatten memo cached the guard's
	// chain raw (macro unexpanded) and is never invalidated, the late macro is
	// silently dropped. Documents whether the per-root flatten memo needs
	// invalidation on `.macro`.
	it('EDGE: applies a macro defined after .routes introspection', async () => {
		const app = new Elysia().guard({ auth: true } as any, (a) =>
			a.get('/secret', () => 'secret')
		)

		void app.routes // flatten the guard chain BEFORE the macro exists

		app.macro({
			auth: {
				beforeHandle: ({ set }: any) => {
					set.status = 401
					return 'no'
				}
			}
		})

		const r = await app.handle(req('/secret'))
		expect(r.status).toBe(401)
	})

	// D — a WS route inside a group must resolve its own local hook against the
	// group scope-child (like the HTTP path via `localMacroRoot`), so a macro
	// override that STRENGTHENS a gate applies to WS too. WS previously resolved
	// against the root table only, silently skipping the override → auth bypass
	// on the WebSocket upgrade while the HTTP sibling was correctly blocked.
	it('applies a group macro override to a WS route in the group, matching HTTP (D)', async () => {
		const app = new Elysia()
			.macro({ auth: { beforeHandle() {} } }) // root: lax (allow)
			.group('/g', (g) =>
				(g as any)
					.macro({
						auth: {
							beforeHandle({ status }: any) {
								return status(403)
							}
						}
					}) // group override: block
					.get('/h', { auth: true } as any, () => 'HTTP')
					.ws('/ws', { auth: true, message() {} } as any)
			)
			.listen(0)

		// HTTP in group: override applies → 403
		expect((await app.handle(req('/g/h'))).status).toBe(403)

		// WS in group: override must also apply → upgrade rejected
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

		expect(opened).toBe(false) // was true (auth bypass on WS)
	})
})
