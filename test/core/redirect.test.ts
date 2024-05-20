import { describe, expect } from 'bun:test'
import Elysia from '../../src'
import { req, namedElysiaIt } from '../utils'

describe('Redirect: `aot: true`', () => {
	namedElysiaIt(handles_redirect_without_explicit_status, { aot: true })
	namedElysiaIt(handles_redirect_with_explicit_status, { aot: true })
})

describe('Redirect: `aot: false`', () => {
	namedElysiaIt(handles_redirect_without_explicit_status, { aot: false })
	namedElysiaIt(handles_redirect_with_explicit_status, { aot: false })
})

async function handles_redirect_without_explicit_status(this: Elysia) {
	const app = this.get('/', ({ set }) => {
		set.redirect = '/hello'
	})

	const res = await app.handle(req('/'))
	expect(res.status).toBe(302)
	expect(res.headers.get('location')).toBe('/hello')
}

async function handles_redirect_with_explicit_status(this: Elysia) {
	const app = this.get('/', ({ set }) => {
		set.redirect = '/hello'
		set.status = 303
	})

	const res = await app.handle(req('/'))
	expect(res.status).toBe(303)
	expect(res.headers.get('location')).toBe('/hello')
}
