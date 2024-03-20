import { Elysia } from '../../src'
import { req } from '../../test/utils'
import { describe, it, expect } from 'bun:test'

// ? Some hooks type are already tested in there respective lifecycle tests
// ? This files is to verify weird behavior of hook type in general
describe('Hook Types', () => {
	it('should clone function to prevent hookType link', async () => {
		const plugin = new Elysia({ name: 'plugin' }).derive(
			{ as: 'scoped' },
			() => {
				return { id: 1 }
			}
		)

		expect(plugin.event.transform[0].scope).toBe('scoped')

		const a = new Elysia().use(plugin).get('/foo', ({ id }) => {
			return { id, name: 'foo' }
		})

		expect(plugin.event.transform[0].scope).toBe('scoped')

		const b = new Elysia().use(plugin).get('/bar', ({ id }) => {
			return { id, name: 'bar' }
		})

		expect(plugin.event.transform[0].scope).toBe('scoped')

		const [res1, res2] = await Promise.all([
			a.handle(req('/foo')).then((x) => x.json()),
			b.handle(req('/bar')).then((x) => x.json())
		])

		expect(res1).toEqual({ id: 1, name: 'foo' })
		expect(res2).toEqual({ id: 1, name: 'bar' })
	})
})
