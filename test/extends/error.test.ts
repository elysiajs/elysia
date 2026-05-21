/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'
import z from 'zod'
import { AnyElysia } from '../../src/base'

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

const getErrors = (app: AnyElysia) =>
	app['~ext']?.error ? [...app['~ext'].error] : undefined

describe('Error extends', () => {
	it('add single', async () => {
		const app = new Elysia().error(CustomError, () => {})

		expect(getErrors(app)).toEqual([CustomError])
	})

	it('add multiple', async () => {
		const app = new Elysia()
			.error(CustomError, () => {})
			.error(CustomError2, () => {})

		expect(getErrors(app)).toEqual([CustomError, CustomError2])
	})

	it('add duplicate', async () => {
		const app = new Elysia()
			.error(CustomError, () => {})
			.error(CustomError2, () => {})
			.error(CustomError2, () => {})

		expect(getErrors(app)).toEqual([CustomError, CustomError2])
	})

	it('inherits functional plugin', async () => {
		const plugin = (app: Elysia) => app.error(CustomError, () => { })

		const app = new Elysia().use(plugin)

		expect(getErrors(app)).toEqual([CustomError])
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().error(CustomError, () => { })

		const app = new Elysia().use(plugin)

		expect(getErrors(app)).toEqual([CustomError])
	})

	it('preserve status code base on error if not set', async () => {
		const app = new Elysia().onError(({ code }) => {
			if (code === 'NOT_FOUND') return 'UwU'
		})

		const response = await app.handle(req('/not/found'))

		expect(await response.text()).toBe('UwU')
		expect(response.status).toBe(404)
	})

	it('validation error should be application/json', async () => {
		// @ts-expect-error
		const app = new Elysia().get('/', () => '1', {
			response: t.Null()
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(422)
		expect(response.headers.get('content-type')).toBe('application/json')
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
			.onError(({ code, error, status }) => {
				switch (code) {
					case 'VALIDATION':
						return error.detail(error.message)
				}
			})
			.post('/', ({ body, set }) => 'ok', {
				body: sendOtpSchema
			})

		const response = await app.handle(post('/', {}))

		expect(response.status).toBe(422)
	})
})
