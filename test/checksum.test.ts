import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Checksum', () => {
	it('deduplicate plugin', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform(() => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie({}))
			.use(group)
			.get('/cookie', () => 'Hi')

		// @ts-ignore
		const [a, b] = app.routes

		expect(a.hooks.transform!.length).toBe(1)
		expect(b.hooks.transform!.length).toBe(1)
	})

	it('Set default checksum if not provided when name is set', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform(() => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		// @ts-ignore
		const [a, b] = app.routes

		expect(a.hooks.transform!.length).toBe(1)
		expect(b.hooks.transform!.length).toBe(1)
	})

	it('Accept plugin when seed is different', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform(() => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(group)
			.use(
				cookie({
					hello: 'world'
				})
			)
			.get('/cookie', () => 'Hi')

		// @ts-ignore
		const [a, b] = app.routes

		expect(
			Math.abs(a.hooks.transform!.length - b.hooks.transform!.length)
		).toBe(1)
	})

	it('Always accept plugin when name is not provided', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				seed: options
			}).onTransform(() => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		// @ts-ignore
		const [a, b] = app.routes

		expect(
			Math.abs(a.hooks.transform!.length - b.hooks.transform!.length)
		).toBe(1)
	})
})
