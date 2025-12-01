import { describe, expect, it } from 'bun:test'
import Elysia, { t } from '../../src'
import { post } from '../utils'

describe('TypeSystem - MaybeNull', () => {
	it('OpenAPI compliant', () => {
		const schema = t.MaybeNull(t.String());

		expect(schema).toMatchObject({
			type: "string",
			nullable: true
		});

		const objSchema = t.Object({
			name: t.MaybeNull(t.String())
		});

		expect(objSchema).toMatchObject({
			type: "object",
			properties: {
				name: {
					type: "string",
					nullable: true
				}
			},
		});
	});

	it('Validate', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.Nullable(t.String())
			})
		})

		const res1 = await app.handle(
			post('/', {
				name: '123'
			})
		)
		expect(res1.status).toBe(200)
		expect(await res1.json()).toEqual({ name: '123' })

		const res2 = await app.handle(post('/', {
			name: null
		}))
		expect(res2.status).toBe(200)
		expect(await res2.json()).toEqual({ name: null })

		const res3 = await app.handle(post('/', {}))
		expect(res3.status).toBe(422)
	});
})