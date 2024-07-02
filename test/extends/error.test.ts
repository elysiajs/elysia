/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

class CustomError extends Error {
	constructor() {
		super()
	}
}

const getErrors = (app: Elysia<any, any, any, any, any>) =>
	// @ts-ignore
	Object.keys(app.definitions.error)

describe('Error', () => {
	it('add single', async () => {
		const app = new Elysia().error('CUSTOM_ERROR', CustomError)

		expect(getErrors(app)).toEqual(['CUSTOM_ERROR'])
	})

	it('add multiple', async () => {
		const app = new Elysia()
			.error('CUSTOM_ERROR', CustomError)
			.error('CUSTOM_ERROR_2', CustomError)

		expect(getErrors(app)).toEqual(['CUSTOM_ERROR', 'CUSTOM_ERROR_2'])
	})

	it('add object', async () => {
		const app = new Elysia().error({
			CUSTOM_ERROR: CustomError,
			CUSTOM_ERROR_2: CustomError
		})

		expect(getErrors(app)).toEqual(['CUSTOM_ERROR', 'CUSTOM_ERROR_2'])
	})

	// it('remap error', async () => {
	// 	const app = new Elysia()
	// 		.error({
	// 			CUSTOM_ERROR: CustomError,
	// 			CUSTOM_ERROR_2: CustomError
	// 		})
	// 		.error(({ CUSTOM_ERROR, ...rest }) => ({
	// 			...rest,
	// 			CUSTOM_ERROR_3: CustomError
	// 		}))

	// 	expect(getErrors(app)).toEqual(['CUSTOM_ERROR', 'CUSTOM_ERROR_2'])
	// })

	it('inherits functional plugin', async () => {
		const plugin = (app: Elysia) => app.error('CUSTOM_ERROR', CustomError)

		const app = new Elysia().use(plugin)

		expect(getErrors(app)).toEqual(['CUSTOM_ERROR'])
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().error('CUSTOM_ERROR', CustomError)

		const app = new Elysia().use(plugin)

		expect(getErrors(app)).toEqual(['CUSTOM_ERROR'])
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
})
