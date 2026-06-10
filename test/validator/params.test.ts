import { Elysia, t, ValidationError } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Params Validator', () => {
	it('parse params without validator', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/617'))

		expect(await res.text()).toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate single', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id, {
			params: t.Object({
				id: t.String()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(await res.text()).toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get(
			'/id/:id/name/:name',
			({ params }) => params,
			{
				params: t.Object({
					id: t.String(),
					name: t.String()
				})
			}
		)
		const res = await app.handle(req('/id/617/name/Ga1ahad'))

		expect(await res.json()).toEqual({
			id: '617',
			name: 'Ga1ahad'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get('/id/:id', () => '', {
			params: t.Object({
				id: t.String()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get('/id/:id', ({ params }) => params, {
			params: t.Object({
				id: t.Numeric()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(await res.json()).toEqual({
			id: 617
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get(
			'/id/:id/chapter/:chapterId',
			({ params }) => params,
			{
				params: t.Object({
					id: t.Numeric(),
					chapterId: t.Numeric()
				})
			}
		)
		const res = await app.handle(req('/id/617/chapter/12'))

		expect(await res.json()).toEqual({
			id: 617,
			chapterId: 12
		})
		expect(res.status).toBe(200)
	})

	it('parse single integer', async () => {
		const app = new Elysia().get('/id/:id', ({ params }) => params, {
			params: t.Object({
				id: t.Integer()
			})
		})
		const res = await app.handle(req('/id/617'))
		expect(await res.json()).toEqual({
			id: 617
		})
		expect(res.status).toBe(200)
	})

	it('parse malformed integer', async () => {
		const app = new Elysia().get('/id/:id', ({ params }) => params, {
			params: t.Object({
				id: t.Integer()
			})
		})

		const res = await app.handle(req('/id/617.1234'))
		// New TypeBox (1.x) reports JSONSchema-style errors with
		// `keyword` / `params` / `instancePath`. The shape below
		// matches what `ValidationError.toResponseBody()` produces.
		// `anyOf` branch order: [Number (Integer source), Refined
		// String (codec source for IntegerString)].
		expect(await res.json()).toMatchObject({
			type: 'validation',
			on: 'params',
			property: '/id',
			summary: 'must be number',
			message: 'must be number',
			found: {
				id: '617.1234'
			},
			errors: [
				{
					keyword: 'type',
					schemaPath: '#/properties/id/anyOf/0',
					instancePath: '/id',
					params: { type: 'number' },
					message: 'must be number'
				},
				{
					keyword: '~refine',
					schemaPath: '#/properties/id/anyOf/1',
					instancePath: '/id',
					params: { index: 0, message: 'must be integer' },
					message: 'must be integer'
				},
				{
					keyword: 'anyOf',
					schemaPath: '#/properties/id',
					instancePath: '/id',
					message: 'must match a schema in anyOf'
				}
			]
		})
		expect(res.status).toBe(422)
	})

	it('parse multiple integer', async () => {
		const app = new Elysia().get(
			'/id/:id/chapter/:chapterId',
			({ params }) => params,
			{
				params: t.Object({
					id: t.Integer(),
					chapterId: t.Integer()
				})
			}
		)
		const res = await app.handle(req('/id/617/chapter/12'))
		expect(await res.json()).toEqual({
			id: 617,
			chapterId: 12
		})
		expect(res.status).toBe(200)
	})

	it('create default string params', async () => {
		const app = new Elysia().get('/:name', ({ params }) => params, {
			params: t.Object({
				name: t.String(),
				faction: t.String({ default: 'tea_party' })
			})
		})

		const value = await app.handle(req('/nagisa')).then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			faction: 'tea_party'
		})
	})

	it('create default number params', async () => {
		const app = new Elysia().get('/:name', ({ params }) => params, {
			params: t.Object({
				name: t.String(),
				rank: t.Number({ default: 1 })
			})
		})

		const value = await app.handle(req('/nagisa')).then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			rank: 1
		})
	})

	it('coerce number object to numeric', async () => {
		const app = new Elysia().get(
			'/id/:id',
			({ params: { id } }) => typeof id,
			{
				params: t.Object({
					id: t.Number()
				})
			}
		)

		const value = await app.handle(req('/id/1')).then((x) => x.text())

		expect(value).toBe('number')
	})

	it('coerce string object to boolean', async () => {
		const app = new Elysia().get(
			'/is-admin/:value',
			({ params: { value } }) => typeof value,
			{
				params: t.Object({
					value: t.Boolean()
				})
			}
		)

		const value = await app
			.handle(req('/is-admin/true'))
			.then((x) => x.text())

		expect(value).toBe('boolean')
	})

	describe('create default value on optional params', () => {
		it('parse multiple optional params', async () => {
			const app = new Elysia().get(
				'/name/:last?/:first?',
				({ params: { first, last } }) => `${last}/${first}`,
				{
					params: t.Object({
						first: t.String({
							default: 'fubuki'
						}),
						last: t.String({
							default: 'shirakami'
						})
					})
				}
			)

			const res = await Promise.all([
				app.handle(req('/name')).then((x) => x.text()),
				app.handle(req('/name/kurokami')).then((x) => x.text()),
				app.handle(req('/name/kurokami/sucorn')).then((x) => x.text())
			])

			expect(res).toEqual([
				'shirakami/fubuki',
				'kurokami/fubuki',
				'kurokami/sucorn'
			])
		})
	})

	it('handle coerce TransformDecodeError', async () => {
		let err: Error | undefined

		const app = new Elysia()
			.get('/id/:id', ({ body }) => body, {
				params: t.Object({
					year: t.Numeric({ minimum: 1900, maximum: 2160 })
				}),
				error({ error }) {
					// `code` was removed this version; dispatch via instanceof.
					if (error instanceof ValidationError) err = error
				}
			})
			.listen(0)

		await app.handle(req('/id/3000'))

		expect(err instanceof ValidationError).toBe(true)
	})
})
