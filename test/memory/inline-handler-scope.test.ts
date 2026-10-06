import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { settle } from './_settle'

const N = 2000

// every app stays reachable, so none is collected inside another's census
const keep: Elysia[] = []

// A first hit swaps the route's lazy entry for its compiled handler, one
// scope for one. Counted as the slope over a second batch of hits on the same
// app, so garbage from an earlier test cannot land between the two counts
const scopesPerHit = async (app: Elysia, status = 200) => {
	keep.push(app)

	const hit = async (from: number) => {
		for (let i = from; i < from + N; i++) {
			const res = await app.handle(`/r${i}`)
			if (res.status !== status) throw new Error(`r${i}: ${res.status}`)
		}

		return (await settle()).objectTypeCounts.JSLexicalEnvironment ?? 0
	}

	const before = await hit(0)
	const after = await hit(N)

	return (after - before) / N
}

describe('inline handler memory', () => {
	// A closure built inside `compileHandlerJit` keeps the compiler's whole
	// captured scope (key set, param arrays, emit helpers) alive for as long
	// as the route lives: ~720 B and one more scope per route
	it('a route reading set does not retain the compiler scope', async () => {
		const app = new Elysia()
		for (let i = 0; i < 2 * N; i++)
			app.get(`/r${i}`, ({ set }) => {
				set.headers['x-a'] = '1'

				return 'hi'
			})

		// a retained compiler scope makes this 1
		expect(await scopesPerHit(app)).toBeLessThan(0.5)
	})

	// default headers send every function route down the same inline path
	it('a route under default headers does not retain the compiler scope', async () => {
		const app = new Elysia().headers({ 'x-powered-by': 'Elysia' })
		for (let i = 0; i < 2 * N; i++) app.get(`/r${i}`, () => 'hi')

		expect(await scopesPerHit(app)).toBeLessThan(0.5)
	})

	// `compileHandler` wraps a static Error or an HTML bundle in a thrower
	// whose own scope is 1 per route. Built inside `compileHandler`, it also
	// keeps `compileHandler`'s scopes alive: 3 or 4
	it('a static Error route does not retain the compiler scope', async () => {
		const app = new Elysia()
		for (let i = 0; i < 2 * N; i++) app.get(`/r${i}`, new Error('boom'))

		expect(await scopesPerHit(app, 500)).toBeLessThan(1.5)
	})

	it('an HTML bundle route does not retain the compiler scope', async () => {
		const app = new Elysia()
		for (let i = 0; i < 2 * N; i++)
			app.get(`/r${i}`, { index: './index.html', files: [] })

		expect(await scopesPerHit(app, 500)).toBeLessThan(1.5)
	})
})
