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

	// ? Blocking on https://github.com/oven-sh/bun/issues/1435
	// it('skip traling slash on strict path', async () => {
	// 	const app = new Elysia({
	// 		strictPath: true
	// 	}).get('/a', () => 'a')

	// 	const withTrailing = await app.handle(req('/a/'))
	// 	expect(await withTrailing.text()).toBe('Not Found')

	// 	const noTrailing = await app.handle(req('/a'))
	// 	expect(await noTrailing.text()).toBe('a')
	// })

	// ? Blocking on https://github.com/oven-sh/bun/issues/1435
	// it('skip non trailing on strict path', async () => {
	// 	const app = new Elysia({
	// 		strictPath: true
	// 	}).get('/a/', () => 'a')

	// 	const withTrailing = await app.handle(req('/a/'))
	// 	expect(await withTrailing.text()).toBe('a')

	// 	const noTrailing = await app.handle(req('/a'))
	// 	expect(await noTrailing.text()).toBe('Not Found')
	// })
})
