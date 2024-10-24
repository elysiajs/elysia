import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Response Redirect', () => {
	it('handle redirect', async () => {
		const app = new Elysia().get('/', ({ redirect }) => redirect('/skadi'))

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		expect(headers.toJSON()).toEqual({
			location: '/skadi'
		})
	})

	it('handle redirect status', async () => {
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('/skadi', 301)
		)

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(301)
		expect(headers.toJSON()).toEqual({
			location: '/skadi'
		})
	})

	it('add set.headers to redirect', async () => {
		const app = new Elysia().get('/', ({ redirect, set }) => {
			set.headers.alias = 'Abyssal Hunter'

			return redirect('/skadi')
		})

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		expect(headers.toJSON()).toEqual({
			location: '/skadi',
			alias: 'Abyssal Hunter'
		})
	})

	it('set multiple cookie on redirect', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { name, name2 }, redirect }) => {
				name.value = 'a'
				name2.value = 'b'

				return redirect('/skadi')
			}
		)

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		expect(headers.toJSON()).toEqual({
			location: '/skadi',
			// @ts-expect-error - Unsure where this comes from, set cookie can return an array. Maybe the type is expecting comma separated values?
			'set-cookie': ['name=a; Path=/', 'name2=b; Path=/']
		})
	})
})
