import { describe, it, expect } from 'bun:test'

import { Elysia, form, redirect } from '../../../src'

import { mapResponse } from '../../../src/adapter/web-standard/handler'
import { Passthrough } from './utils'
import { req } from '../../utils'

const createContext = () => ({
	cookie: {},
	headers: {},
	status: 200
})

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

	toString() {
		return JSON.stringify({
			name: this.name
		})
	}
}

class CustomResponse extends Response {}

describe('Web Standard - Map Response', () => {
	it('map string', async () => {
		const response = mapResponse('Shiroko', createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map number', async () => {
		const response = mapResponse(1, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map boolean', async () => {
		const response = mapResponse(true, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('true')
		expect(response.status).toBe(200)
	})

	it('map object', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = mapResponse(body, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map function', async () => {
		const response = mapResponse(() => 1, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map undefined', async () => {
		const response = mapResponse(undefined, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map null', async () => {
		const response = mapResponse(null, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')

		const response = mapResponse(file, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.arrayBuffer()).toEqual(await file.arrayBuffer())
		expect(response.status).toBe(200)
	})

	it('map File', async () => {
		const file = new File(['Hello'], 'hello.txt', { type: 'text/plain' })

		const response = mapResponse(file, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Hello')
		expect(response.status).toBe(200)
	})

	it('map Promise', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapResponse(
			new Promise((resolve) => resolve(body)),
			createContext()
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map Error', async () => {
		const response = mapResponse(new Error('Hello'), createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.json()).toEqual({
			name: 'Error',
			message: 'Hello'
		})
		expect(response.status).toBe(500)
	})

	it('map Response', async () => {
		const response = mapResponse(new Response('Shiroko'), createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom Response', async () => {
		const response = mapResponse(
			new CustomResponse('Shiroko'),
			createContext()
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom Response with custom headers', async () => {
		const response = mapResponse(new CustomResponse('Shiroko'), {
			...createContext(),
			headers: {
				'content-type': 'text/html; charset=utf8'
			}
		})

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf8'
		)
	})

	it('map custom class', async () => {
		const response = mapResponse(new Student('Himari'), createContext())

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
			'content-type': 'application/json'
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
		const response = await mapResponse(new Response('Shiroko'), context)
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual(headers)
	})

	it('map Response and merge Headers', async () => {
		const response = await mapResponse(
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
		const response = mapResponse(redirect('https://cunny.school', 302), {
			status: "I'm a teapot",
			headers: {
				Name: 'Sorasaki Hina'
			},
			redirect: 'https://cunny.school',
			cookie: {}
		})

		expect(response).toBeInstanceOf(Response)
		expect(response.status).toBe(302)
		// expect(await response.text()).toEqual('Shiroko')
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
		expect(response.headers.get('name')).toEqual('Sorasaki Hina')
		expect(response.headers.getAll('set-cookie')).toEqual(['name=hina'])
	})

	it('set multiple cookie', async () => {
		const response = mapResponse('Hina', {
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
		expect(await response.text()).toEqual('Hina')
		expect(response.headers.get('name')).toEqual('Sorasaki Hina')
		expect(response.headers.getAll('set-cookie')).toEqual([
			'name=hina',
			'affiliation=gehenna'
		])
	})

	it('map toResponse', async () => {
		const response = mapResponse(new Passthrough(), createContext())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('hi')
		expect(response.status).toBe(200)
	})

	it('map video content-range', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const response = mapResponse(kyuukararin, createContext())

		expect(response).toBeInstanceOf(Response)
		expect(response.headers.get('accept-ranges')).toEqual('bytes')
		expect(response.headers.get('content-range')).toEqual(
			`bytes 0-${kyuukararin.size - 1}/${kyuukararin.size}`
		)
		expect(response.status).toBe(200)
	})

	it('skip content-range on not modified', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const response = mapResponse(kyuukararin, {
			...createContext(),
			status: 304
		})

		expect(response).toBeInstanceOf(Response)
		expect(response.headers.get('accept-ranges')).toBeNull()
		expect(response.headers.get('content-range')).toBeNull()
		expect(response.status).toBe(304)
	})

	it('map formdata', async () => {
		const response = mapResponse(
			form({
				a: Bun.file('test/kyuukurarin.mp4')
			}),
			createContext()
		)

		expect(await response.formData()).toBeInstanceOf(FormData)
		// ? Auto appended by Bun
		// expect(response.headers.get('content-type')).toStartWith(
		// 	'multipart/form-data'
		// )
		expect(response.status).toBe(200)
	})

	it('map beforeHandle', async () => {
		const app = new Elysia()
			.mapResponse(() => {
				return new Response('b')
			})
			.get('/', () => 'a', {
				beforeHandle() {
					return 'a'
				}
			})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('b')
	})

	it('map afterHandle', async () => {
		const app = new Elysia()
			.mapResponse(() => {
				return new Response('b')
			})
			.get('/', () => 'a', {
				beforeHandle() {
					return 'a'
				}
			})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('b')
	})
})
