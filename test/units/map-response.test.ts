import { describe, it, expect } from 'bun:test'
import { mapResponse } from '../../src/handler'

const defaultContext = {
	cookie: {},
	headers: {},
	status: 200
}

const context = {
	cookie: {},
	headers: {
		'x-powered-by': 'Elysia',
		'coffee-scheme': 'Coffee'
	},
	status: 418
}

class Student {
	constructor(public name: string) {}
}

describe('Map Response', () => {
	it('map string', async () => {
		const response = mapResponse('Shiroko', defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map number', async () => {
		const response = mapResponse(1, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map boolean', async () => {
		const response = mapResponse(true, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('true')
		expect(response.status).toBe(200)
	})

	it('map object', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = mapResponse(body, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map function', async () => {
		const response = mapResponse(() => 1, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map undefined', async () => {
		const response = mapResponse(undefined, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map null', async () => {
		const response = mapResponse(null, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')

		const response = mapResponse(file, defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.arrayBuffer()).toEqual(await file.arrayBuffer())
		expect(response.status).toBe(200)
	})

	it('map Promise', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapResponse(
			new Promise((resolve) => resolve(body)),
			defaultContext
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map Error', async () => {
		const response = mapResponse(new Error('Hello'), defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual({
			name: 'Error',
			message: 'Hello'
		})
		expect(response.status).toBe(500)
	})

	it('map Response', async () => {
		const response = mapResponse(new Response('Shiroko'), defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom class', async () => {
		const response = mapResponse(new Student('Himari'), defaultContext)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual({
			name: 'Himari'
		})
		expect(response.status).toBe(200)
	})

	it('map primitive with custom context', async () => {
		const response = mapResponse('Shiroko', context)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('Shiroko')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(418)
	})

	it('map undefined with context', async () => {
		const response = mapResponse(undefined, context)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(418)
	})

	it('map null with custom context', async () => {
		const response = mapResponse(null, context)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(418)
	})

	it('map Function with custom context', async () => {
		const response = await mapResponse(() => 1, context)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('1')
		expect(response.headers.toJSON()).toEqual({
			...context.headers
		})
		expect(response.status).toBe(418)
	})

	it('map Promise with custom context', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapResponse(
			new Promise((resolve) => resolve(body)),
			context
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual(body)
		expect(response.headers.toJSON()).toEqual({
			...context.headers,
			'content-type': 'application/json;charset=utf-8'
		})
		expect(response.status).toBe(418)
	})

	it('map Error with custom context', async () => {
		const response = mapResponse(new Error('Hello'), context)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual({
			name: 'Error',
			message: 'Hello'
		})
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(418)
	})

	it('map Response with custom context', async () => {
		const response = mapResponse(new Response('Shiroko'), context)
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual(headers)
	})

	it('map Response and merge Headers', async () => {
		const response = mapResponse(
			new Response('Shiroko', {
				headers: {
					Name: 'Himari'
				}
			}),
			context
		)
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual({
			...headers,
			name: 'Himari'
		})
	})

	it('map named status', async () => {
		const response = mapResponse('Shiroko', {
			status: "I'm a teapot",
			headers: {},
			cookie: {}
		})

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('Shiroko')
		expect(response.status).toBe(418)
	})

	it('map redirect', async () => {
		const response = mapResponse('Shiroko', {
			status: "I'm a teapot",
			headers: {
				Name: 'Sorasaki Hina'
			},
			redirect: 'https://cunny.school',
			cookie: {}
		})
		expect(response).toBeInstanceOf(Response)
		expect(response.status).toBe(302)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual({
			name: 'Sorasaki Hina',
			location: 'https://cunny.school'
		})
	})

	it('set cookie', async () => {
		const response = mapResponse('Hina', {
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
		expect(await response.text()).toEqual('Hina')
		expect(response.headers.toJSON()).toEqual({
			name: 'Sorasaki Hina',
			'Set-Cookie': ['name=hina']
		})
	})

	it('set multiple cookie', async () => {
		const response = mapResponse('Hina', {
			status: 200,
			headers: {
				Name: 'Sorasaki Hina'
			},
			cookie: {
				name: {
					value: ['hina', 'iori']
				},
				affiliation: {
					value: 'gehenna'
				}
			}
		})
		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Hina')
		expect(response.headers.toJSON()).toEqual({
			name: 'Sorasaki Hina',
			'Set-Cookie': ['name=hina,name=iori,affiliation=gehenna']
		})
	})
})
