/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from 'bun:test'
import Elysia from '../../src'
import { req } from '../utils'

describe('Scope', () => {
	it('Multiple scopes registering all routes', async () => {
		const app = new Elysia()

		const plugin = new Elysia({
			prefix: 'Plugin',
			scoped: true
		}).get('/testPrivate', () => 'OK')

		const plugin2 = new Elysia({
			prefix: 'PluginNext',
			scoped: true
		}).get('/testPrivate', () => 'OK')

		app.use(plugin).use(plugin2)

		const res = await app.handle(req('/Plugin/testPrivate'))

		expect(res.status).toBe(200)

		const res1 = await app.handle(req('/PluginNext/testPrivate'))
		expect(res1.status).toBe(200)
	})
})
