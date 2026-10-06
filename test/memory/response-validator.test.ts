import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { settle } from './_settle'

const N = 2000

// every app stays reachable, so none is collected inside another's census
const keep: Elysia<any, any, any, any, any, any, any, any>[] = []

// bytes each route retains once compiled: the slope between two apps of N
// routes, so whatever one app or the module costs cancels out
const bytesPerRoute = async (
	register: (app: Elysia, paths: string[]) => unknown,
	eager: boolean
) => {
	const compiled = async (tag: string) => {
		const app = new Elysia()
		register(
			app,
			Array.from({ length: N }, (_, i) => `/${tag}${i}`)
		)

		if (eager) app.compile()
		else
			for (let i = 0; i < N; i++) {
				const res = await app.handle(`/${tag}${i}`)
				if (res.status !== 200)
					throw new Error(`${tag}${i}: ${res.status}`)
			}

		keep.push(app)
		return (await settle()).heapSize
	}

	await compiled('w')
	const before = await compiled('a')
	const after = await compiled('b')

	return (after - before) / N
}

// A numeric key makes JSC allocate indexed storage sized to the key, so a
// `{ 200: validator }` costs ~2.3 KB per route and `{ 401, 403 }` ~3.2 KB.
// The response validators are bound to the compiled route instead
for (const eager of [false, true])
	describe(`response validator memory (${eager ? 'eager' : 'lazy'})`, () => {
		it('a response schema keeps no status-indexed object', async () => {
			// ~3.2 KB with a `{ 200: validator }` object, ~0.4 KB without
			expect(
				await bytesPerRoute((app, paths) => {
					for (const path of paths)
						app.get(path, { response: t.String() }, () => 'hi')
				}, eager)
			).toBeLessThan(1500)
		})

		it('a shared status map guard keeps no status-indexed object per route', async () => {
			// ~6 KB with a `{ 200, 401, 403 }` object per route, ~0.6 KB without
			expect(
				await bytesPerRoute((app, paths) => {
					app.guard(
						{ response: { 401: t.String(), 403: t.String() } },
						(guarded) => {
							for (const path of paths)
								guarded.get(
									path,
									{ response: t.String() },
									() => 'hi'
								)

							return guarded
						}
					)
				}, eager)
			).toBeLessThan(2000)
		})
	})
