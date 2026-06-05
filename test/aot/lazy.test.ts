import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource, autoGroupSize } from '../../src/plugin/source'
import { post, req } from '../utils'

/**
 * AOT lazy validator groups — validators emit as SYNC group thunks instead of an
 * eager tree. At boot only the thunks + the route→group map are parsed; a group's
 * factory structures are built on the first hit to one of its routes (no eval, no
 * import). This is the JIT-like idle-memory lever: structures materialize on use.
 */

// Eval a `register:false` lazy manifest into its groups/groupOf/handlers. The
// thunk bodies are only DEFINED here (params shadow CheckContext/…), never run
// until a group is materialised — so no TypeBox internals are needed to eval.
const evalLazy = (src: string): any =>
	new Function(
		src
			.replace('export const groups', 'const groups')
			.replace('export const groupOf', 'const groupOf')
			.replace('export const handlers', 'const handlers') +
			'\nreturn { groups, groupOf, handlers }'
	)()

const build = () =>
	new Elysia()
		.post('/body', ({ body }) => body, {
			body: t.Object({ hello: t.String() })
		})
		.get('/q', ({ query }) => query, {
			query: t.Object({ id: t.Numeric() })
		})

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('AOT lazy validator groups', () => {
	it('emits group thunks + a route→group map (no eager `validators`)', async () => {
		// 1 route per group → /body and /q land in distinct groups
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD

		// 2 routes, 1/group → 2 inline thunks in `_groups`
		expect((src.match(/\(\) => \{/g) ?? []).length).toBe(2)
		expect(src).toContain('export const groups')
		expect(src).toContain('"/body":0') // groupOf maps the route to its group
		// the whole point: NO eager validators tree (those build at boot)
		expect(src).not.toContain('export const validators')
	})

	it('defers each group until first hit, materialises once, sync', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		// spy each thunk to prove WHEN it's called (i.e. when structures build)
		const calls = [0, 0]
		const spied = groups.map(
			(g: () => unknown, i: number) =>
				() => {
					calls[i]++
					return g()
				}
		)

		Validator.clear()
		Compiled.registerLazyValidators(spied, groupOf)
		Compiled.handlers = handlers

		expect(calls).toEqual([0, 0]) // registration builds nothing

		// touch /body (group 0) → ONLY group 0 materialises
		expect(Compiled.getValidator('POST', '/body', 'body')).toBeDefined()
		expect(calls).toEqual([1, 0])

		// touch again → cached, no re-materialisation
		Compiled.getValidator('POST', '/body', 'body')
		expect(calls).toEqual([1, 0])

		// /q is a different group → builds only now
		expect(Compiled.getValidator('GET', '/q', 'query')).toBeDefined()
		expect(calls).toEqual([1, 1])
	})

	it('hasValidator is lazy-aware — true without materializing the group', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		const calls = [0, 0]
		const spied = groups.map(
			(g: () => unknown, i: number) =>
				() => {
					calls[i]++
					return g()
				}
		)
		Validator.clear()
		Compiled.registerLazyValidators(spied, groupOf)
		Compiled.handlers = handlers

		// the content-cache bypass needs existence WITHOUT building the group
		expect(Compiled.hasValidator('POST', '/body', 'body')).toBe(true)
		expect(calls).toEqual([0, 0]) // nothing materialized
		expect(Compiled.hasValidator('POST', '/nope', 'body')).toBe(false)
	})

	it('hoists a schema shared across groups to top-level (keeps shared-schema apps small)', async () => {
		// same body on 3 routes, 1 route/group → 3 groups all referencing it
		const body = t.Object({ hello: t.String() })
		const app = new Elysia()
			.post('/a', ({ body }: any) => body, { body })
			.post('/b', ({ body }: any) => body, { body })
			.post('/c', ({ body }: any) => body, { body })

		const src = await compileToSource(app as any, { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD

		// ONE entry despite 3 routes in 3 groups (cross-group dedup preserved)…
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/\(\) => \{/g) ?? []).length).toBe(3) // 3 inline thunks
		// …hoisted to top-level (before `_groups`), not duplicated inside each
		expect(src.indexOf('const _c0')).toBeLessThan(src.indexOf('_groups'))

		// and it still serves through any group
		const { groups, groupOf, handlers } = evalLazy(src)
		Validator.clear()
		Compiled.registerLazyValidators(groups, groupOf)
		Compiled.handlers = handlers
		const ok = await app.handle(post('/b', { hello: 'world' }))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ hello: 'world' })
	})

	it('keeps distinct-per-route schemas fully lazy (nothing hoisted)', async () => {
		const app = new Elysia()
			.post('/a', ({ body }: any) => body, {
				body: t.Object({ a: t.String() })
			})
			.post('/b', ({ body }: any) => body, {
				body: t.Object({ b: t.String() })
			})

		const src = await compileToSource(app as any, { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD

		// every `_c` lives INSIDE a thunk — none before `_groups`
		const firstThunk = src.indexOf('_groups')
		const topLevelEntries = (
			src.slice(0, firstThunk).match(/const _c\d+ =/g) ?? []
		).length
		expect(topLevelEntries).toBe(0)
	})

	it('is eval-free by construction (CF-safe: no new Function / eval / dynamic import)', async () => {
		const app = new Elysia()
			.post('/x', ({ body }: any) => body, {
				body: t.Object({ n: t.Numeric() }) // codec exercises mirror branches too
			})
		const src = await compileToSource(app as any, {
			register: true,
			lazy: true
		})
		delete process.env.ELYSIA_AOT_BUILD

		expect(src).not.toMatch(/\bnew Function\b/)
		expect(src).not.toMatch(/\beval\s*\(/)
		expect(src).not.toMatch(/\bimport\s*\(/) // sync thunks, not dynamic import
		expect(src).toContain('Compiled.registerLazyValidators')
	})

	it('serves end-to-end through the lazy manifest (≡ eager behaviour)', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 64 })
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		Validator.clear()
		Compiled.registerLazyValidators(groups, groupOf)
		Compiled.handlers = handlers

		const app = build()
		const ok = await app.handle(post('/body', { hello: 'world' }))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ hello: 'world' })

		const bad = await app.handle(post('/body', { hello: 123 }))
		expect(bad.status).toBe(422) // frozen check rejects, materialised on hit

		const q = await app.handle(req('/q?id=5'))
		expect(await q.json()).toEqual({ id: 5 }) // codec coerced through frozen mirror
	})
})

describe('AOT lazy group size (auto-scale)', () => {
	it('scales the group size by route count', () => {
		expect(autoGroupSize(1)).toBe(1)
		expect(autoGroupSize(63)).toBe(1)
		expect(autoGroupSize(64)).toBe(2)
		expect(autoGroupSize(255)).toBe(2)
		expect(autoGroupSize(256)).toBe(4)
		expect(autoGroupSize(2047)).toBe(4)
		expect(autoGroupSize(2048)).toBe(16)
		expect(autoGroupSize(8191)).toBe(16)
		expect(autoGroupSize(8192)).toBe(64)
	})

	it('`lazy: true` auto-scales the emitted group count; a number overrides', async () => {
		const make = (n: number) => {
			const app = new Elysia()
			for (let i = 0; i < n; i++)
				app.post(`/r${i}`, ({ body }: any) => body, {
					body: t.Object({ [`k${i}`]: t.String() }) // distinct → all stay lazy
				})
			return app
		}

		// 100 routes (< 256) → auto groupSize 2 → ceil(100/2) inline thunks
		const auto = await compileToSource(make(100) as any, {
			register: false,
			lazy: true
		})
		delete process.env.ELYSIA_AOT_BUILD
		expect((auto.match(/\(\) => \{/g) ?? []).length).toBe(
			Math.ceil(100 / autoGroupSize(100))
		)

		// an explicit number wins
		const fixed = await compileToSource(make(100) as any, {
			register: false,
			lazy: 25
		})
		delete process.env.ELYSIA_AOT_BUILD
		expect((fixed.match(/\(\) => \{/g) ?? []).length).toBe(Math.ceil(100 / 25))
	})
})
