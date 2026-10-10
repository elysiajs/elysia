import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'

// Rule: a hook applies only to routes registered after it, including routes
// that arrived through `.use(child)` or a `.guard()` group before the hook
describe('hook order across child instances', () => {
	const build = () => {
		const log: string[] = []
		const hook = (name: string) => () => {
			log.push(name)
		}
		const child = new Elysia().get('/child', () => 'ok')
		const app = new Elysia()
			.guard({}, (app) => app.get('/guarded', () => 'ok'))
			.get('/own', () => 'ok')
			.use(child)
			.onAfterHandle(hook('local-late'))
			.onAfterHandle('global', hook('global-late'))
			.get('/late', () => 'ok')

		return { app, log }
	}

	for (const path of ['/own', '/guarded', '/child'])
		it(`a late hook does not reach ${path}`, async () => {
			const { app, log } = build()
			await app.handle(new Request('http://localhost' + path))
			expect(log).toEqual([])
		})

	it('a late hook reaches a route registered after it', async () => {
		const { app, log } = build()
		await app.handle(new Request('http://localhost/late'))
		expect(log).toEqual(['local-late', 'global-late'])
	})
})
