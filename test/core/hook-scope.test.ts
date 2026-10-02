import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

// An unrecognised scope used to register the hook as local, so a plugin's
// 1.x-style `{ as: 'scoped' }` auth hook silently stopped guarding the
// routes of the app that used it
describe('hook scope', () => {
	for (const scope of [{ as: 'scoped' }, { as: 'global' }, 'scoped', 'Global'])
		it(`rejects ${JSON.stringify(scope)}`, () => {
			expect(() =>
				new Elysia().beforeHandle(scope as any, () => {})
			).toThrow('[Elysia] Invalid hook scope')

			expect(() => new Elysia().derive(scope as any, () => ({}))).toThrow(
				'[Elysia] Invalid hook scope'
			)

			// the object form hits guard's own 1.x migration error first
			expect(() =>
				new Elysia().guard(scope as any, { beforeHandle() {} })
			).toThrow(/Invalid hook scope|was removed in 2\.0/)
		})

	it('accepts every 2.0 scope', async () => {
		const plugin = new Elysia()
			.beforeHandle('plugin', ({ set }) => {
				set.headers['x-plugin'] = '1'
			})
			.beforeHandle('global', ({ set }) => {
				set.headers['x-global'] = '1'
			})
			.beforeHandle('local', () => {})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
		const res = await app.handle(new Request('http://localhost/'))

		expect(res.headers.get('x-plugin')).toBe('1')
		expect(res.headers.get('x-global')).toBe('1')
	})

	// 1.x `schema: 'standalone'` silently fell back to the override channel,
	// so a guard's own validation stopped running under routes with a schema
	it('rejects an unknown guard schema mode', () => {
		for (const schema of ['standalone', 'Merge'])
			expect(() =>
				new Elysia().guard({ schema: schema as any }, (app) => app)
			).toThrow('[Elysia] Invalid guard schema')

		expect(() =>
			new Elysia().guard({ schema: 'merge' }, (app) => app)
		).not.toThrow()
		expect(() =>
			new Elysia().guard({ schema: 'override' }, (app) => app)
		).not.toThrow()
	})
})
