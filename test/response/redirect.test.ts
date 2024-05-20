import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req, namedElysiaIt } from '../utils'

async function handle_redirect(this: Elysia) {
	const app = this.get('/', ({ redirect }) => redirect('/skadi'))

	const { headers, status } = await app.handle(req('/'))

	expect(status).toBe(301)
	// @ts-expect-error
	expect(headers.toJSON()).toEqual({
		location: '/skadi'
	})
}

async function handle_redirect_status(this: Elysia) {
	const app = this.get('/', ({ redirect }) => redirect('/skadi', 302))

	const { headers, status } = await app.handle(req('/'))

	expect(status).toBe(302)
	// @ts-expect-error
	expect(headers.toJSON()).toEqual({
		location: '/skadi'
	})
}

async function add_set_headers_to_redirect(this: Elysia) {
	const app = new Elysia().get('/', ({ redirect, set }) => {
		set.headers.alias = 'Abyssal Hunter'

		return redirect('/skadi')
	})

	const { headers, status } = await app.handle(req('/'))

	expect(status).toBe(301)
	// @ts-expect-error
	expect(headers.toJSON()).toEqual({
		location: '/skadi',
		alias: 'Abyssal Hunter'
	})
}

async function set_multiple_cookie_on_redirect(this: Elysia) {
	const app = new Elysia().get(
		'/',
		({ cookie: { name, name2 }, redirect }) => {
			name.value = 'a'
			name2.value = 'b'

			return redirect('/skadi')
		}
	)

	const { headers, status } = await app.handle(req('/'))

	expect(status).toBe(301)
	// @ts-expect-error
	expect(headers.toJSON()).toEqual({
		location: '/skadi',
		'set-cookie': ['name=a', 'name2=b']
	})
}

describe('Response Headers: `aot: true`', () => {
	namedElysiaIt(handle_redirect, { aot: true })
	namedElysiaIt(handle_redirect_status, { aot: true })
	namedElysiaIt(add_set_headers_to_redirect, { aot: true })
	namedElysiaIt(set_multiple_cookie_on_redirect, { aot: true })
})

describe('Response Headers: `aot: false`', () => {
	namedElysiaIt(handle_redirect, { aot: false })
	namedElysiaIt(handle_redirect_status, { aot: false })
	namedElysiaIt(add_set_headers_to_redirect, { aot: false })
	namedElysiaIt(set_multiple_cookie_on_redirect, { aot: false })
})
