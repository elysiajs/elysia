import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Config', () => {
	it('handle non strict path by default', async () => {
		const app = new Elysia().get('/a', () => 'a')

		const withTrailing = await app.handle(req('/a/'))
		expect(await withTrailing.text()).toBe('a')

		const noTrailing = await app.handle(req('/a'))
		expect(await noTrailing.text()).toBe('a')
	})

	it('skip traling slash on strict path', async () => {
		const app = new Elysia({
			strictPath: true
		}).get('/a', () => 'a')

		const withTrailing = await app.handle(req('/a/'))
		expect(await withTrailing.text()).toBe('NOT_FOUND')

		const noTrailing = await app.handle(req('/a'))
		expect(await noTrailing.text()).toBe('a')
	})

	it('skip non trailing on strict path', async () => {
		const app = new Elysia({
			strictPath: true
		}).get('/a/', () => 'a')

		const withTrailing = await app.handle(req('/a/'))
		expect(await withTrailing.text()).toBe('a')

		const noTrailing = await app.handle(req('/a'))
		expect(await noTrailing.text()).toBe('NOT_FOUND')
	})
})
