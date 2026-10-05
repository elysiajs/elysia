import { describe, expect, it } from 'bun:test'
import { heapStats } from 'bun:jsc'

import { Elysia } from '../../src'

// closures and their scopes, counted per object (deterministic, unlike bytes)
const cells = () => {
	Bun.gc(true)
	Bun.gc(true)
	const counts = heapStats().objectTypeCounts

	return (counts.Function ?? 0) + (counts.JSLexicalEnvironment ?? 0)
}

const N = 1000

// every app stays reachable, so none is collected inside another's census
const keep: Elysia[] = []

const perRoute = async (mode: 'lazy' | 'compile', prefix: string) => {
	const build = (n: number, p: string) => {
		const app = new Elysia()
		for (let i = 0; i < n; i++) app.get(`/${p}${i}/:id`, () => 'ok')
		if (mode === 'compile') app.compile()
		keep.push(app)

		return app
	}

	const hitAll = async (app: Elysia, n: number, p: string) => {
		for (let i = 0; i < n; i++) {
			const res = await app.handle(`/${p}${i}/x`)
			if (res.status !== 200) throw new Error(`${p}${i}: ${res.status}`)
		}
	}

	// warm the code paths on a throwaway app
	const warm = build(20, prefix + 'w')
	await hitAll(warm, 20, prefix + 'w')

	const before = cells()
	const app = build(N, prefix)
	await hitAll(app, N, prefix)
	const after = cells()

	return (after - before) / N
}

describe('lazy dynamic route memory', () => {
	// A lazy dynamic route must not keep its per-route dispatch thunk (a
	// closure plus its scope) in Memoirist once JIT compiled it. Once every
	// route is hit, lazy must cost what compile() costs.
	it('a hit lazy dynamic route retains no more closures than compile()', async () => {
		const compiled = await perRoute('compile', 'c')
		const lazy = await perRoute('lazy', 'l')

		// a kept thunk makes lazy - compiled = 2 (Function + JSLexicalEnvironment)
		expect(lazy - compiled).toBeLessThan(0.5)
	})
})
