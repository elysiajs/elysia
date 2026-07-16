import { Elysia, t, TypeBoxValidator } from '../../src'

import { describe, expect, it, spyOn } from 'bun:test'
import { req } from '../utils'

describe('Inherited plugin hook isolation', () => {
	it('keeps hook order isolated across sibling routes and repeated requests', async () => {
		const trace: string[] = []

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
			.guard({}, (guarded) =>
				guarded
					.beforeHandle(({ path }) => {
						trace.push(`local-before:${path}`)
					})
					.get('/d', () => 'd')
			)

		app.compile()

		const expected: Record<string, string[]> = {
			'/a': ['transform:/a', 'before:/a'],
			'/b': ['transform:/b', 'before:/b'],
			'/c': ['transform:/c', 'before:/c'],
			'/d': ['transform:/d', 'before:/d', 'local-before:/d']
		}

		for (const path of ['/a', '/b', '/c', '/d']) {
			for (let pass = 0; pass < 2; pass++) {
				trace.length = 0
				const res = await app.handle(req(path))

				await expect(res.text()).resolves.toBe(path.slice(1))
				expect(trace).toEqual(expected[path])
			}
		}
	})

	it('does not duplicate inherited response validators across sibling routes', async () => {
		const check = spyOn(TypeBoxValidator.prototype, 'Check')

		try {
			const plugin = new Elysia().guard('global', {
				response: t.Object({ name: t.String() })
			})

			const app = new Elysia()
				.use(plugin)
				.get('/a', () => ({ name: 'a' }))
				.get('/b', () => ({ name: 'b' }))
				.get('/c', () => ({ name: 'c' }))

			app.compile()

			for (const path of ['/a', '/b', '/c']) {
				const res = await app.handle(req(path))
				expect(res.status).toBe(200)
			}

			expect(check).toHaveBeenCalledTimes(3)
		} finally {
			check.mockRestore()
		}
	})

	it('runs one inherited derive per request on every sibling route', async () => {
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
			expect(counts[path]).toBe(1)
		}
	})
})
