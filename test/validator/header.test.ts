import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

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

		expect(await res.json<any>()).toEqual({
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

		expect(await res.json<any>()).toEqual({
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

		expect(await res.json<any>()).toEqual({
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

		expect(await res.json<any>()).toEqual({
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
		expect(await res.json<any>()).toEqual({})
	})

	it('validate numberic with partial', async () => {
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
		expect(await res.json<any>()).toEqual({})
	})

	it('loosely validate by default', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String()
			})
		})

		const headers = {
			name: 'sucrose',
			job: 'alchemist'
		}
		const res = await app.handle(
			req('/', {
				headers
			})
		)

		expect(await res.json<any>()).toEqual(headers)
		expect(res.status).toBe(200)
	})
})
