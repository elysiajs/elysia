import { describe, it, expect } from 'bun:test'

import { mapEarlyResponse } from '../../../src/adapter/web-standard/handler'
import { form, redirect } from '../../../src/utils'
import { Passthrough } from './utils'

const defaultContext = {
	headers: {},
	status: 200,
	cookie: {}
}

const context = {
	headers: {
		'x-powered-by': 'Elysia',
		'coffee-scheme': 'Coffee'
	},
	status: 418,
	cookie: {}
}

class Student {
	constructor(public name: string) {}

	toString() {
		return JSON.stringify({
			name: this.name
		})
	}
}

class CustomResponse extends Response {}

describe('Web Standard - Map Early Response', () => {
	it('map string', async () => {
		const response = mapEarlyResponse('Shiroko', defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('Shiroko')
		expect(response?.status).toBe(200)
	})

	it('map number', async () => {
		const response = mapEarlyResponse(1, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('1')
		expect(response?.status).toBe(200)
	})

	it('map boolean', async () => {
		const response = mapEarlyResponse(true, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('true')
		expect(response?.status).toBe(200)
	})

	it('map object', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = mapEarlyResponse(body, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.json()).toEqual(body)
		expect(response?.status).toBe(200)
	})

	it('map function', async () => {
		const response = mapEarlyResponse(() => 1, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('1')
		expect(response?.status).toBe(200)
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')

		const response = mapEarlyResponse(file, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.arrayBuffer()).toEqual(await file.arrayBuffer())
		expect(response?.status).toBe(200)
	})

	it('map File', async () => {
		const file = new File(['Hello'], 'hello.txt', { type: 'text/plain' })

		const response = mapEarlyResponse(file, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Hello')
		expect(response?.status).toBe(200)
	})

	it('map Promise', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapEarlyResponse(
			new Promise((resolve) => resolve(body)),
			defaultContext
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.json()).toEqual(body)
		expect(response?.status).toBe(200)
	})

	it('map Response', async () => {
		const response = mapEarlyResponse(
			new Response('Shiroko'),
			defaultContext
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Shiroko')
		expect(response?.status).toBe(200)
	})

	it('map custom Response', async () => {
		const response = mapEarlyResponse(
			new CustomResponse('Shiroko'),
			defaultContext
		)!

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom Response with custom headers', async () => {
		const response = mapEarlyResponse(new CustomResponse('Shiroko'), {
			...defaultContext,
			headers: {
				'content-type': 'text/html; charset=utf8'
			}
		})!

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf8'
		)
	})

	it('map custom class', async () => {
		const response = mapEarlyResponse(new Student('Himari'), defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.json()).toEqual({
			name: 'Himari'
		})
		expect(response?.status).toBe(200)
	})

	it('map primitive with custom context', async () => {
		const response = mapEarlyResponse('Shiroko', context)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('Shiroko')
		expect(response?.headers.toJSON()).toEqual(context.headers)
		expect(response?.status).toBe(418)
	})

	it('map Function with custom context', async () => {
		const response = await mapEarlyResponse(() => 1, context)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('1')
		expect(response?.headers.toJSON()).toEqual({
			...context.headers
		})
		expect(response?.status).toBe(418)
	})

	it('map Promise with custom context', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapEarlyResponse(
			new Promise((resolve) => resolve(body)),
			context
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.json()).toEqual(body)
		expect(response?.headers.toJSON()).toEqual({
			...context.headers,
			'content-type': 'application/json'
		})
		expect(response?.status).toBe(418)
	})

	it('map Error with custom context', async () => {
		const response = mapEarlyResponse(new Error('Hello'), context)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.json()).toEqual({
			name: 'Error',
			message: 'Hello'
		})
		expect(response?.headers.toJSON()).toEqual(context.headers)
		expect(response?.status).toBe(418)
	})

	it('map Response with custom context', async () => {
		const response = await mapEarlyResponse(
			new Response('Shiroko'),
			context
		)
		const headers = response?.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Shiroko')
		expect(response?.headers.toJSON()).toEqual(headers as any)
	})

	it('map Response and merge Headers', async () => {
		const response = await mapEarlyResponse(
			new Response('Shiroko', {
				headers: {
					Name: 'Himari'
				}
			}),
			context
		)
		const headers = response?.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Shiroko')
		expect(response?.headers.toJSON()).toEqual({
			...headers,
			name: 'Himari'
		})
	})

	it('map named status', async () => {
		const response = mapEarlyResponse('Shiroko', {
			status: "I'm a teapot",
			headers: {},
			cookie: {}
		})

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toBe('Shiroko')
		expect(response?.status).toBe(418)
	})

	it('map redirect', async () => {
		const response = mapEarlyResponse(redirect('https://cunny.school'), {
			status: "I'm a teapot",
			cookie: {},
			headers: {
				Name: 'Sorasaki Hina'
			},
			redirect: 'https://cunny.school'
		})
		expect(response).toBeInstanceOf(Response)
		// expect(await response?.text()).toEqual('Shiroko')
		expect(response?.headers.toJSON()).toEqual({
			name: 'Sorasaki Hina',
			location: 'https://cunny.school'
		})

		expect(response).toBeInstanceOf(Response)
		expect(response?.status).toBe(302)
	})

	it('map undefined', async () => {
		const response = mapEarlyResponse(undefined, defaultContext)

		expect(response).toBeUndefined()
	})

	it('map null', async () => {
		const response = mapEarlyResponse(null, defaultContext)

		expect(response).toBeUndefined()
	})

	it('set cookie', async () => {
		const response = mapEarlyResponse('Hina', {
			status: 200,
			headers: {
				Name: 'Sorasaki Hina'
			},
			cookie: {
				name: {
					value: 'hina'
				}
			}
		})
		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Hina')
		expect(response?.headers.get('name')).toEqual('Sorasaki Hina')
		expect(response?.headers.getAll('set-cookie')).toEqual(['name=hina'])
	})

	it('set multiple cookie', async () => {
		const response = mapEarlyResponse('Hina', {
			status: 200,
			headers: {
				Name: 'Sorasaki Hina'
			},
			cookie: {
				name: {
					value: 'hina'
				},
				affiliation: {
					value: 'gehenna'
				}
			}
		})
		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('Hina')
		expect(response?.headers.get('name')).toEqual('Sorasaki Hina')
		expect(response?.headers.getAll('set-cookie')).toEqual([
			'name=hina',
			'affiliation=gehenna'
		])
	})

	it('map toResponse', async () => {
		const response = mapEarlyResponse(new Passthrough(), defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response?.text()).toEqual('hi')
		expect(response?.status).toBe(200)
	})

	it('map video content-range', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const response = mapEarlyResponse(kyuukararin, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(response?.headers.get('accept-ranges')).toEqual('bytes')
		expect(response?.headers.get('content-range')).toEqual(
			`bytes 0-${kyuukararin.size - 1}/${kyuukararin.size}`
		)
		expect(response?.status).toBe(200)
	})

	it('skip content-range on not modified', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const response = mapEarlyResponse(kyuukararin, {
			...defaultContext,
			status: 304
		})

		expect(response).toBeInstanceOf(Response)
		expect(response?.headers.get('accept-ranges')).toBeNull()
		expect(response?.headers.get('content-range')).toBeNull()
		expect(response?.status).toBe(304)
	})

	it('map formdata', async () => {
		const response = mapEarlyResponse(
			form({
				a: Bun.file('test/kyuukurarin.mp4')
			}),
			defaultContext
		)!

		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
		expect(response.status).toBe(200)
		expect(await response.formData()).toBeInstanceOf(FormData)
	})
})
