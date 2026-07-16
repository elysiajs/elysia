import { Elysia } from '../../src'
import { req } from '../utils'
import { describe, it, expect } from 'bun:test'

const lastHookScope = (app: any): string | undefined => {
	let cur = app['~hookChain']
	while (cur && 'combine' in cur) cur = cur.over
	return cur?.scope
}

describe('plugin hook scope', () => {
	it('stays unchanged when the plugin is reused by multiple apps', async () => {
		const plugin = new Elysia({ name: 'plugin' }).derive('plugin', () => {
			return { id: 1 }
		})

		expect(lastHookScope(plugin)).toBe('plugin')

		const a = new Elysia().use(plugin).get('/foo', ({ id }) => {
			return { id, name: 'foo' }
		})

		expect(lastHookScope(plugin)).toBe('plugin')

		const b = new Elysia().use(plugin).get('/bar', ({ id }) => {
			return { id, name: 'bar' }
		})

		expect(lastHookScope(plugin)).toBe('plugin')

		const [res1, res2] = await Promise.all([
			a.handle(req('/foo')).then((x) => x.json()),
			b.handle(req('/bar')).then((x) => x.json())
		])

		expect(res1).toEqual({ id: 1, name: 'foo' })
		expect(res2).toEqual({ id: 1, name: 'bar' })
	})
})
