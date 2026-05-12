import { Elysia } from '../../src'
import { req } from '../../test/utils'
import { describe, it, expect } from 'bun:test'

// Verifies that registering a scoped hook on a plugin and then `use`-ing
// the plugin from multiple parents doesn't mutate the plugin's chain (its
// node scope is set at registration and stays put — propagation creates
// new per-scope nodes on each parent without touching the plugin's own).
// The legacy `app.event.transform[0].scope` API is gone; the new
// equivalent is the chain node's `scope` field on `~hookChain`.
const tipScope = (app: any): string | undefined => {
	let cur = app['~hookChain']
	while (cur && 'combine' in cur) cur = cur.over
	return cur?.scope
}

describe('Hook Types', () => {
	it('should clone function to prevent hookType link', async () => {
		const plugin = new Elysia({ name: 'plugin' }).derive(
			{ as: 'scoped' },
			() => {
				return { id: 1 }
			}
		)

		// Plugin's chain head is the derive node, registered as `scoped`
		// (normalised to `plugin`).
		expect(tipScope(plugin)).toBe('plugin')

		const a = new Elysia().use(plugin).get('/foo', ({ id }) => {
			return { id, name: 'foo' }
		})

		expect(tipScope(plugin)).toBe('plugin')

		const b = new Elysia().use(plugin).get('/bar', ({ id }) => {
			return { id, name: 'bar' }
		})

		expect(tipScope(plugin)).toBe('plugin')

		const [res1, res2] = await Promise.all([
			a.handle(req('/foo')).then((x) => x.json()),
			b.handle(req('/bar')).then((x) => x.json())
		])

		expect(res1).toEqual({ id: 1, name: 'foo' })
		expect(res2).toEqual({ id: 1, name: 'bar' })
	})
})
