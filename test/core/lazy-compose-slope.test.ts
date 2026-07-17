import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

const buildChain = (
	depth: number,
	perLevel: number,
	opt: Record<string, unknown>
): number => {
	let node: any = new Elysia(opt)
	for (let r = 0; r < perLevel; r++) node = node.get(`/seed${r}`, () => r)
	for (let d = 1; d < depth; d++) {
		let parent: any = new Elysia({ prefix: `/l${d}`, ...opt })
		parent = parent.use(node)
		for (let r = 0; r < perLevel; r++)
			parent = parent.get(`/own${d}_${r}`, () => r)
		node = parent
	}
	return node.routes.length as number
}

const eagerOpt = () => ({}) as Record<string, unknown>
const lazyOpt = () =>
	({ experimental: { lazyCompose: true } }) as Record<string, unknown>

// Best-of-N limits scheduler and GC noise in this timing assertion.
const bestMs = (
	depth: number,
	routes: number,
	opt: Record<string, unknown>,
	iterations: number
) => {
	const perLevel = Math.max(1, Math.round(routes / depth))
	let realized = 0
	let best = Infinity
	for (let i = 0; i < iterations; i++) {
		const t0 = performance.now()
		realized = buildChain(depth, perLevel, opt)
		best = Math.min(best, performance.now() - t0)
	}
	return { ms: best, realized }
}

// parked: lazyCompose lane dropped pre-N+1; re-lands with the N+3a authoring DAG — see design/necessity-audit-2026-07-17.md
describe.skip('experimental.lazyCompose build scaling', () => {
	it('grows slower with nesting depth than eager composition', () => {
		const ROUTES = 1_000
		const ITER = 7

		buildChain(16, 63, eagerOpt())
		buildChain(16, 63, lazyOpt())
		buildChain(64, 16, eagerOpt())
		buildChain(64, 16, lazyOpt())

		const eager16 = bestMs(16, ROUTES, eagerOpt(), ITER)
		const eager64 = bestMs(64, ROUTES, eagerOpt(), ITER)
		const lazy16 = bestMs(16, ROUTES, lazyOpt(), ITER)
		const lazy64 = bestMs(64, ROUTES, lazyOpt(), ITER)

		expect(lazy16.realized).toBe(eager16.realized)
		expect(lazy64.realized).toBe(eager64.realized)

		const eagerSlope = eager64.ms / eager16.ms
		const lazySlope = lazy64.ms / lazy16.ms

		expect(eagerSlope).toBeGreaterThan(1.5)

		expect(lazySlope).toBeLessThan(2.65)
	})
})
