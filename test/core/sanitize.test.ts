import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { post } from '../utils'

describe('Sanitize', () => {
	it('handle single sanitize', async () => {
		const app = new Elysia({
			sanitize: (v) => (v === 'a' ? 'ok' : v)
		}).post('/', ({ body }) => body, {
			body: t.Object({
				a: t.String(),
				b: t.String(),
				c: t.String()
			})
		})

		const response = await app
			.handle(
				post('/', {
					a: 'a',
					b: 'b',
					c: 'c'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ a: 'ok', b: 'b', c: 'c' })
	})

	it('multiple sanitize', async () => {
		const app = new Elysia({
			sanitize: [
				(v) => (v === 'a' ? 'ok' : v),
				(v) => (v === 'b' ? 'ok' : v)
			]
		}).post('/', ({ body }) => body, {
			body: t.Object({
				a: t.String(),
				b: t.String(),
				c: t.String()
			})
		})

		const response = await app
			.handle(
				post('/', {
					a: 'a',
					b: 'b',
					c: 'c'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ a: 'ok', b: 'ok', c: 'c' })
	})

	it('handle sanitize in plugin from main', async () => {
		const plugin = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				a: t.String(),
				b: t.String(),
				c: t.String()
			})
		})

		const app = new Elysia({
			sanitize: (v) => (v === 'a' ? 'ok' : v)
		}).use(plugin)

		const response = await app
			.handle(
				post('/', {
					a: 'a',
					b: 'b',
					c: 'c'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ a: 'ok', b: 'b', c: 'c' })
	})

	it('handle top-level string', async () => {
		const app = new Elysia({
			sanitize: (v) => (v === 'a' ? 'ok' : v)
		}).post('/', ({ body }) => body, {
			body: t.String()
		})

		const response = await app
			.handle(
				new Request('http://localhost', {
					method: 'POST',
					headers: {
						'Content-Type': 'text/plain'
					},
					body: 'a'
				})
			)
			.then((x) => x.text())

		expect(response).toBe('ok')
	})
})
