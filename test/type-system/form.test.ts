import { Elysia, file, form, t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { Value } from '@sinclair/typebox/value'
import { req } from '../utils'

describe('TypeSystem - Form', () => {
	it('Create', () => {
		expect(Value.Create(t.Form({}))).toEqual(form({}))

		expect(
			Value.Create(
				t.Form(
					{},
					{
						default: form({
							name: 'saltyaom'
						})
					}
				)
			)
		).toEqual(
			form({
				name: 'saltyaom'
			})
		)
	})

	it('Check', () => {
		const schema = t.Form({
			name: t.String(),
			age: t.Number()
		})

		expect(
			Value.Check(
				schema,
				form({
					name: 'saltyaom',
					age: 20
				})
			)
		).toBe(true)

		try {
			Value.Check(
				schema,
				form({
					name: 'saltyaom'
				})
			)
			expect(true).toBe(false)
		} catch {
			expect(true).toBe(true)
		}
	})

	it('Integrate', async () => {
		const app = new Elysia()
			.get(
				'/form/:name',
				({ params: { name } }) =>
					form({
						name: name as any
					}),
				{
					response: t.Form({
						name: t.Literal('saltyaom')
					})
				}
			)
			.get(
				'/file',
				() =>
					form({
						teapot: file('example/teapot.webp')
					}),
				{
					response: t.Form({
						teapot: t.File()
					})
				}
			)

		const res1 = await app.handle(req('/form/saltyaom'))
		expect(res1.status).toBe(200)

		const res2 = await app.handle(req('/form/felis'))
		expect(res2.status).toBe(422)

		const res3 = await app.handle(req('/file'))
		expect(res3.status).toBe(200)
	})
})
