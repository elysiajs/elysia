import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Query Validator', () => {
	it('validate single', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name, {
			query: t.Object({
				name: t.String()
			})
		})
		const res = await app.handle(req('/?name=sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&trait=dog')
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
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&trait=dog')
		)

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String())
			})
		})
		const res = await app.handle(req('/?name=sucrose&job=alchemist'))

		expect(await res.json<any>()).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric()
			})
		})
		const res = await app.handle(req('/?name=sucrose&job=alchemist&age=16'))

		expect(await res.json<any>()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric(),
				rank: t.Numeric()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&age=16&rank=4')
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
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Partial(
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

	it('parse numeric with partial', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Partial(
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

	it('parse boolean string', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				param1: t.BooleanString()
			})
		})
		const res = await app.handle(req('/?param1=true'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ param1: true })
	})
})
