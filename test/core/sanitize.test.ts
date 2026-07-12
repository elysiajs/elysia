import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { post } from '../utils'

describe('Sanitize', () => {
	it('sanitizes fully-closed bodies like open bodies', async () => {
		const sanitize = (value: unknown) =>
			typeof value === 'string' ? value.replaceAll('<', '&lt;') : value
		const app = new Elysia({ sanitize })
			.post(
				'/closed',
				{
					body: t.Object(
						{ value: t.String() },
						{ additionalProperties: false }
					)
				},
				({ body }) => body
			)
			.post(
				'/open',
				{
					body: t.Object(
						{ value: t.String() },
						{ additionalProperties: true }
					)
				},
				({ body }) => body
			)

		const responses = await Promise.all(
			['/closed', '/open'].map((path) =>
				app
					.handle(post(path, { value: '<script>' }))
					.then((x) => x.json())
			)
		)

		expect(responses).toEqual([
			{ value: '&lt;script>' },
			{ value: '&lt;script>' }
		])
	})

	it('sanitizes a fully-closed body through FromAsync', async () => {
		const validator = new TypeBoxValidator(
			t.Object({ value: t.String() }, { additionalProperties: false }),
			{
				sanitize: (value) =>
					typeof value === 'string'
						? value.replaceAll('<', '&lt;')
						: value
			}
		)

		await expect(
			validator.FromAsync({ value: '<script>' })
		).resolves.toEqual({
			value: '&lt;script>'
		})
	})

	it('handle single sanitize', async () => {
		const app = new Elysia({
			sanitize: (v) => (v === 'a' ? 'ok' : v)
		}).post(
			'/',
			{
				body: t.Object({
					a: t.String(),
					b: t.String(),
					c: t.String()
				})
			},
			({ body }) => body
		)

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
		}).post(
			'/',
			{
				body: t.Object({
					a: t.String(),
					b: t.String(),
					c: t.String()
				})
			},
			({ body }) => body
		)

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
		const plugin = new Elysia().post(
			'/',
			{
				body: t.Object({
					a: t.String(),
					b: t.String(),
					c: t.String()
				})
			},
			({ body }) => body
		)

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
		}).post(
			'/',
			{
				body: t.String()
			},
			({ body }) => body
		)

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
