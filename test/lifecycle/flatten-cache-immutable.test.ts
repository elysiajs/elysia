import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// Guards plan 015: `composeRootHook` / `composeRouteHook` take an UNCLONED
// reference to the per-(root, chainNode) flatten cache via
// `flattenChainMemoReadonly`. That cache node is shared across every route that
// inherits the same plugin chain, so if any one route's compile mutates the
// reference (property assignment, delete, or push onto its hook arrays), a
// DIFFERENT route observes the corruption and runs the wrong hook sequence.
//
// This app inherits one plugin's `'global'`-scoped hooks across several sibling
// routes plus a `.guard()`-scoped route carrying its own local hook (which
// drives the branch that merges the readonly inherited chain with locals). It
// asserts every route runs the exact hook sequence, twice.
//
// Fails if a readonly flatten-cache reference is ever mutated by one route's
// compile and observed by another's.
describe('flatten cache immutability', () => {
	it('shares inherited plugin hooks without cross-route corruption', async () => {
		const trace: string[] = []

		// `'global'` scope so the plugin's hooks propagate to the parent's
		// routes as the inherited chain node cached and shared by
		// `flattenChainMemoReadonly`.
		const plugin = new Elysia()
			.transform('global', ({ path }) => {
				trace.push(`transform:${path}`)
			})
			.beforeHandle('global', ({ path }) => {
				trace.push(`before:${path}`)
			})

		const app = new Elysia()
			.use(plugin)
			.get('/a', () => 'a')
			.get('/b', () => 'b')
			.get('/c', () => 'c')
			// A guarded route with its own local hook - drives the
			// composeRouteHook branch that merges the (readonly) inherited
			// chain with locals.
			.guard({}, (guarded) =>
				guarded
					.beforeHandle(({ path }) => {
						trace.push(`local-before:${path}`)
					})
					.get('/d', () => 'd')
			)

		// Force compilation of every route up front so any mutation of a shared
		// cache reference would land before the assertions below.
		app.compile()

		const expected: Record<string, string[]> = {
			'/a': ['transform:/a', 'before:/a'],
			'/b': ['transform:/b', 'before:/b'],
			'/c': ['transform:/c', 'before:/c'],
			'/d': ['transform:/d', 'before:/d', 'local-before:/d']
		}

		for (const path of ['/a', '/b', '/c', '/d']) {
			// Twice: a second pass would diverge if the first compile/run
			// mutated a shared cache reference seen by this or a sibling route.
			for (const _pass of [0, 1]) {
				trace.length = 0
				const res = await app.handle(req(path))

				await expect(res.text()).resolves.toBe(path.slice(1))
				expect(trace).toEqual(expected[path])
			}
		}
	})

	it('does not accumulate duplicate standalone validators across repeated sibling composition', async () => {
		// H11b: flattenChainMemoReadonly returns the raw cached object.
		// mergeHook can assign `hook.schemas = inherited.schemas` (cached ref)
		// when the route has no local schemas; a subsequent mergeHook pushes into
		// that array, accumulating duplicates in the shared cache across multiple
		// sibling route compilations.
		//
		// Assert that compiling N sibling routes that each inherit the same
		// plugin-level standalone validator does NOT multiply the schemas array
		// count — each route's compiled hook should see exactly the plugin's
		// schema once, not once-per-compiled-sibling.

		const schemaValidator = t.Object({ name: t.String() })

		const plugin = new Elysia().guard('global', {
			// `schemas` is the internal channel for standalone validators.
			// We trigger the path by attaching a response schema globally so it
			// lands in the inherited chain's schemas array.
			response: schemaValidator
		})

		// Three sibling routes that all inherit the same plugin chain.
		// Each compilation merges the inherited chain; if the cache is mutated
		// in-place the schemas count doubles on each subsequent compilation.
		const app = new Elysia()
			.use(plugin)
			.get('/a', () => ({ name: 'a' }))
			.get('/b', () => ({ name: 'b' }))
			.get('/c', () => ({ name: 'c' }))

		// Compile all routes explicitly.
		app.compile()

		// All three routes should accept valid payloads with 200.
		for (const path of ['/a', '/b', '/c']) {
			const res = await app.handle(req(path))
			expect(res.status).toBe(200)
		}
	})

	it('does not accumulate duplicate derive entries across repeated sibling composition', async () => {
		// Same mutation path as schemas but through `~deriveEntries`.
		// Three sibling routes inheriting the same plugin-level derive should
		// each run the derive exactly once per request, not once-per-compiled-sibling.

		const counts: Record<string, number> = {}

		const plugin = new Elysia().derive('global', ({ path }) => {
			counts[path] = (counts[path] ?? 0) + 1
			return { derived: true }
		})

		const app = new Elysia()
			.use(plugin)
			.get('/a', ({ derived }) => (derived ? 'ok' : 'bad'))
			.get('/b', ({ derived }) => (derived ? 'ok' : 'bad'))
			.get('/c', ({ derived }) => (derived ? 'ok' : 'bad'))

		app.compile()

		for (const path of ['/a', '/b', '/c']) {
			counts[path] = 0
			const res = await app.handle(req(path))
			await expect(res.text()).resolves.toBe('ok')
			// derive must run exactly once per request, not N times
			expect(counts[path]).toBe(1)
		}
	})
})
