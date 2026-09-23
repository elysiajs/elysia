/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, ValidationError, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, json } from '../utils'

import z from 'zod'
import type { AnyElysia } from '../../src/base'

class CustomError extends Error {
	constructor() {
		super()
	}
}

class CustomError2 extends Error {
	constructor() {
		super()
	}
}

class SubError extends CustomError {}

class TeapotError extends Error {
	status = 418
}

const throws = (Class: new () => Error) => () => {
	throw new Class()
}

const text = (app: AnyElysia, path: string) =>
	app.handle(path).then((response) => response.text())

// An error class is "registered" only by the handler `.error(Class, fn)`
// attaches: dispatch is `instanceof`, there is no code dictionary to consult
describe('Error extends', () => {
	it('dispatches a class handler only to instances of that class', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'custom')
			.get('/custom', throws(CustomError))
			.get('/sub', throws(SubError))
			.get('/other', throws(CustomError2))

		await expect(text(app, '/custom')).resolves.toBe('custom')
		// subclasses are instances too
		await expect(text(app, '/sub')).resolves.toBe('custom')

		// an unrelated class falls through to the default problem response
		const other = await app.handle('/other')
		expect(other.status).toBe(500)
		expect(await other.json()).toMatchObject({
			code: 'internal-server-error'
		})
	})

	it('dispatches several classes to their own handlers', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'one')
			.error(CustomError2, () => 'two')
			.get('/one', throws(CustomError))
			.get('/two', throws(CustomError2))

		await expect(text(app, '/one')).resolves.toBe('one')
		await expect(text(app, '/two')).resolves.toBe('two')
	})

	it('lets the first handler registered for a class win', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'first')
			.error(CustomError, () => 'second')
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('first')
	})

	it('answers a static value registered for a class', async () => {
		const app = new Elysia()
			.error(CustomError, 'static')
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('static')
	})

	it('passes the thrown instance, and no error code, to the handler', async () => {
		let context: Record<string, unknown> | undefined
		const thrown = new CustomError()

		const app = new Elysia()
			.error(CustomError, (ctx) => {
				context = ctx
				return 'handled'
			})
			.get('/', () => {
				throw thrown
			})

		await app.handle('/')

		expect(context?.error).toBe(thrown)
		expect(context && 'code' in context).toBe(false)
	})

	it('maps the status from the error class, overridable by the handler', async () => {
		const app = new Elysia()
			.error(TeapotError, () => 'tea')
			.get('/', throws(TeapotError))

		const response = await app.handle('/')
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('tea')

		const overridden = await new Elysia()
			.error(TeapotError, ({ status }) => status(409, 'conflict'))
			.get('/', throws(TeapotError))
			.handle('/')
		expect(overridden.status).toBe(409)
		expect(await overridden.text()).toBe('conflict')

		// a handled error without a status stays a server error
		const plain = await new Elysia()
			.error(CustomError, () => 'handled')
			.get('/', throws(CustomError))
			.handle('/')
		expect(plain.status).toBe(500)
	})

	it('inherits a class handler from a functional plugin', async () => {
		const plugin = (app: Elysia) =>
			app.error(CustomError, () => 'functional')

		const app = new Elysia().use(plugin).get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('functional')
	})

	it('scopes a class handler absorbed from an instance plugin', async () => {
		const route = (plugin: AnyElysia) =>
			text(new Elysia().use(plugin).get('/', throws(CustomError)), '/')
		const grandchild = (plugin: AnyElysia) =>
			text(
				new Elysia()
					.use(new Elysia().use(plugin))
					.get('/', throws(CustomError)),
				'/'
			)

		const local = new Elysia().error(CustomError, () => 'local')
		const plugin = new Elysia().error('plugin', CustomError, () => 'plugin')
		const global = new Elysia().error('global', CustomError, () => 'global')

		// local: stays inside the plugin
		await expect(route(local)).resolves.not.toBe('local')
		// plugin: reaches the direct parent only
		await expect(route(plugin)).resolves.toBe('plugin')
		await expect(grandchild(plugin)).resolves.not.toBe('plugin')
		// global: reaches every ancestor
		await expect(route(global)).resolves.toBe('global')
		await expect(grandchild(global)).resolves.toBe('global')
	})

	// 1.x `.error({ CODE: Class })` registered an error-code dictionary; 2.0
	// dropped error codes (dispatch is by class), so the untyped object form
	// registers no handler at all
	it('ignores the 1.x error-code dictionary form', async () => {
		const app = new Elysia()
			.error({ CUSTOM: CustomError } as any)
			.error(({ error }) => (error instanceof CustomError ? 'general' : undefined))
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('general')

		const bare = await new Elysia()
			.error({ CUSTOM: CustomError } as any)
			.get('/', throws(CustomError))
			.handle('/')
		expect(bare.status).toBe(500)
	})

	it('preserve status code base on error if not set', async () => {
		const app = new Elysia().error(({ error }) => {
			if (error instanceof NotFound) return 'UwU'
		})

		const response = await app.handle('/not/found')

		await expect(response.text()).resolves.toBe('UwU')
		expect(response.status).toBe(404)
	})

	it('validation error should be application/problem+json', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Null()
			},
			// @ts-expect-error
			() => '1'
		)

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		expect(response.headers.get('content-type')).toBe(
			'application/problem+json'
		)
	})

	it('validation error should handle Standard Schema with error.detail', async () => {
		const sendOtpEmailSchema = z.object({
			channel: z.literal('email'),
			otpTo: z.email({ error: 'Must be a valid email address' })
		})

		const sendOtpSmsSchema = z.object({
			channel: z.literal('sms'),
			otpTo: z.e164({
				error: 'Must be a valid phone number with country code'
			})
		})

		const sendOtpSchema = z.discriminatedUnion('channel', [
			sendOtpEmailSchema,
			sendOtpSmsSchema
		])

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post(
				'/',
				{
					body: sendOtpSchema
				},
				({ body, set }) => 'ok'
			)

		const response = await app.handle('/', json({}))

		expect(response.status).toBe(422)
	})
})
