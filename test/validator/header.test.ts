import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'
import { Get } from '@sinclair/typebox/build/cjs/type/registry/type'

describe('Header Validator', () => {
	it('validate single', async () => {
		const app = new Elysia().get('/', ({ headers: { name } }) => name, {
			headers: t.Object({
				name: t.String()
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose'
				}
			})
		)

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist',
					trait: 'dog'
				}
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			trait: 'dog'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get('/', () => '', {
			headers: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist',
					trait: 'dog'
				}
			})
		)

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String())
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist'
				}
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric()
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist',
					age: '16'
				}
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric(),
				rank: t.Numeric()
			})
		})
		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist',
					age: '16',
					rank: '4'
				}
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16,
			rank: 4
		})
		expect(res.status).toBe(200)
	})

	it('validate partial', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Partial(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			)
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({})
	})

	it('validate numeric with partial', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Partial(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String()),
					age: t.Numeric(),
					rank: t.Numeric()
				})
			)
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({})
	})

	it('validate optional object', async () => {
		const app = new Elysia().get(
			'/',
			({ headers }) => headers?.name ?? 'sucrose',
			{
				headers: t.Optional(
					t.Object(
						{
							name: t.String()
						},
						{
							additionalProperties: true
						}
					)
				)
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(
				req('/', {
					headers: {
						name: 'sucrose'
					}
				})
			),
			app.handle(req('/'))
		])

		expect(await valid.text()).toBe('sucrose')
		expect(valid.status).toBe(200)

		expect(await invalid.text()).toBe('sucrose')
		expect(invalid.status).toBe(200)
	})

	it('create default string params', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				faction: t.String({ default: 'tea_party' })
			})
		})

		const value = await app
			.handle(
				req('/', {
					headers: {
						name: 'nagisa'
					}
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			faction: 'tea_party'
		})
	})

	it('create default number params', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String(),
				rank: t.Number({ default: 1 })
			})
		})

		const value = await app
			.handle(
				req('/', {
					headers: {
						name: 'nagisa'
					}
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			rank: 1
		})
	})

	it('coerce number object to numeric', async () => {
		const app = new Elysia().get('/', ({ headers: { id } }) => typeof id, {
			headers: t.Object({
				id: t.Number()
			})
		})

		const value = await app
			.handle(
				req('/', {
					headers: {
						id: '1'
					}
				})
			)
			.then((x) => x.text())

		expect(value).toBe('number')
	})

	it('coerce string to boolean', async () => {
		const app = new Elysia().get(
			'/',
			({ headers }) => typeof headers['is-admin'],
			{
				headers: t.Object({
					'is-admin': t.Boolean()
				})
			}
		)

		const value = await app
			.handle(
				req('/', {
					headers: {
						'is-admin': 'true'
					}
				})
			)
			.then((x) => x.text())

		expect(value).toBe('boolean')
	})

	it('handle optional at root', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Optional(
				t.Object({
					id: t.Numeric()
				})
			)
		})

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.json()),
			app
				.handle(
					req('/', {
						headers: {
							id: '1'
						}
					})
				)
				.then((x) => x.json())
		])

		expect(res).toEqual([{}, { id: 1 }])
	})
})
