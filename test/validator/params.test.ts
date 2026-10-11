import { Elysia, t, ValidationError } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('Params Validator', () => {
	it('parse params without validator', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle('/id/617')

		await expect(res.text()).resolves.toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate single', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.String()
				})
			},
			({ params: { id } }) => id
		)
		const res = await app.handle('/id/617')

		await expect(res.text()).resolves.toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get(
			'/id/:id/name/:name',
			{
				params: t.Object({
					id: t.String(),
					name: t.String()
				})
			},
			({ params }) => params
		)
		const res = await app.handle('/id/617/name/Ga1ahad')

		await expect(res.json()).resolves.toEqual({
			id: '617',
			name: 'Ga1ahad'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.String()
				})
			},
			() => ''
		)
		const res = await app.handle('/id/617')

		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Numeric()
				})
			},
			({ params }) => params
		)
		const res = await app.handle('/id/617')

		await expect(res.json()).resolves.toEqual({
			id: 617
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get(
			'/id/:id/chapter/:chapterId',
			{
				params: t.Object({
					id: t.Numeric(),
					chapterId: t.Numeric()
				})
			},
			({ params }) => params
		)
		const res = await app.handle('/id/617/chapter/12')

		await expect(res.json()).resolves.toEqual({
			id: 617,
			chapterId: 12
		})
		expect(res.status).toBe(200)
	})

	it('parse single integer', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Integer()
				})
			},
			({ params }) => params
		)
		const res = await app.handle('/id/617')
		await expect(res.json()).resolves.toEqual({
			id: 617
		})
		expect(res.status).toBe(200)
	})

	it('reports one user-facing error for a malformed integer', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Integer()
				})
			},
			({ params }) => params
		)

		const res = await app.handle('/id/617.1234')
		const body = (await res.json()) as any
		expect(body).toMatchObject({
			type: 'validation',
			on: 'params',
			property: '/id',
			detail: 'must be number',
			found: {
				id: '617.1234'
			},
			errors: [
				{
					keyword: 'type',
					schemaPath: '#/properties/id',
					instancePath: '/id',
					params: { type: 'number' },
					message: 'must be number'
				}
			]
		})
		expect(body.errors).toHaveLength(1)
		expect(res.status).toBe(422)
	})

	it('parse multiple integer', async () => {
		const app = new Elysia().get(
			'/id/:id/chapter/:chapterId',
			{
				params: t.Object({
					id: t.Integer(),
					chapterId: t.Integer()
				})
			},
			({ params }) => params
		)
		const res = await app.handle('/id/617/chapter/12')
		await expect(res.json()).resolves.toEqual({
			id: 617,
			chapterId: 12
		})
		expect(res.status).toBe(200)
	})

	it('create default string params', async () => {
		const app = new Elysia().get(
			'/:name',
			{
				params: t.Object({
					name: t.String(),
					faction: t.String({ default: 'tea_party' })
				})
			},
			({ params }) => params
		)

		const value = await app.handle('/nagisa').then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			faction: 'tea_party'
		})
	})

	// GHSA-gmm9-qwx3-2m3h: a schema default must never reach generated code
	// unescaped. The `;//` payload is the advisory's original (it breaks a
	// statement-per-line emitter); the `'+(…)+'` payload is expression-shaped so
	// it survives a single-line emitter, which is the shape this branch emits.
	for (const payload of [
		"tea';globalThis.__paramsDefaultValueInjection=1;//",
		"tea'+(globalThis.__paramsDefaultValueInjection=1,'')+'"
	])
		it(`escapes single quote in default string value: ${payload}`, async () => {
			const app = new Elysia().get(
				'/:name',
				{
					params: t.Object({
						name: t.String(),
						faction: t.String({ default: payload })
					})
				},
				({ params }) => params
			)

			const value = await app.handle('/nagisa').then((x) => x.json())

			expect(
				(globalThis as any).__paramsDefaultValueInjection
			).toBeUndefined()
			expect(value.faction).toBe(payload)
		})

	for (const key of [
		"faction'];globalThis.__paramsDefaultKeyInjection=1;//",
		"faction'+(globalThis.__paramsDefaultKeyInjection=1,'')+'"
	])
		it(`escapes single quote in default property key: ${key}`, async () => {
			const app = new Elysia().get(
				'/:name',
				{
					params: t.Object({
						name: t.String(),
						[key]: t.String({ default: 'tea_party' })
					})
				},
				() => 'ok'
			)

			const res = await app.handle('/nagisa')

			expect(
				(globalThis as any).__paramsDefaultKeyInjection
			).toBeUndefined()
			expect(res.status).toBe(200)
		})

	it('create default number params', async () => {
		const app = new Elysia().get(
			'/:name',
			{
				params: t.Object({
					name: t.String(),
					rank: t.Number({ default: 1 })
				})
			},
			({ params }) => params
		)

		const value = await app.handle('/nagisa').then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			rank: 1
		})
	})

	it('coerce number object to numeric', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Number()
				})
			},
			({ params: { id } }) => typeof id
		)

		const value = await app.handle('/id/1').then((x) => x.text())

		expect(value).toBe('number')
	})

	it('coerce string object to boolean', async () => {
		const app = new Elysia().get(
			'/is-admin/:value',
			{
				params: t.Object({
					value: t.Boolean()
				})
			},
			({ params: { value } }) => typeof value
		)

		const value = await app.handle('/is-admin/true').then((x) => x.text())

		expect(value).toBe('boolean')
	})

	describe('create default value on optional params', () => {
		it('parse multiple optional params', async () => {
			const app = new Elysia().get(
				'/name/:last?/:first?',
				{
					params: t.Object({
						first: t.String({
							default: 'fubuki'
						}),
						last: t.String({
							default: 'shirakami'
						})
					})
				},
				({ params: { first, last } }) => `${last}/${first}`
			)

			const res = await Promise.all([
				app.handle('/name').then((x) => x.text()),
				app.handle('/name/kurokami').then((x) => x.text()),
				app.handle('/name/kurokami/sucorn').then((x) => x.text())
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
			.get(
				'/id/:id',
				{
					params: t.Object({
						year: t.Numeric({ minimum: 1900, maximum: 2160 })
					}),
					error({ error }) {
						if (error instanceof ValidationError) err = error
					}
				},
				({ body }) => body
			)
			.listen(0)

		await app.handle('/id/3000')

		expect(err instanceof ValidationError).toBe(true)
	})
})
