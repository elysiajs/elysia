import { describe, it, expect } from 'bun:test'

import { Elysia, file, form, redirect, status } from '../../../src'

import { mapResponse } from '../../../src/adapter/web-standard/handler'
import { Passthrough } from './utils'

const createContext = () => ({
	cookie: {},
	headers: {},
	status: 200
})

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
		await expect(response.text()).resolves.toBe('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map number', async () => {
		const response = mapResponse(1, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toBe('1')
		expect(response.status).toBe(200)
	})

	it('map boolean', async () => {
		for (const value of [true, false]) {
			const response = mapResponse(value, createContext())

			expect(response).toBeInstanceOf(Response)
			await expect(response.text()).resolves.toBe(String(value))
			expect(response.status).toBe(200)
		}
	})

	it('map object', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = mapResponse(body, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map function', async () => {
		const response = mapResponse(() => 1, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toBe('1')
		expect(response.status).toBe(200)
	})

	it('map undefined', async () => {
		const response = mapResponse(undefined, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('')
		expect(response.status).toBe(200)
	})

	it('map null', async () => {
		const response = mapResponse(null, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('')
		expect(response.status).toBe(200)
	})

	it('map undefined to an empty body for 204, 205, and 304', async () => {
		for (const status of [204, 205, 304] as const) {
			const response = mapResponse(undefined, {
				...createContext(),
				status
			})

			expect(response).toBeInstanceOf(Response)
			expect(response.status).toBe(status)
			await expect(response.text()).resolves.toEqual('')
		}
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')

		const response = mapResponse(file, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.arrayBuffer()).resolves.toEqual(
			await file.arrayBuffer()
		)
		expect(response.status).toBe(200)
	})

	it('map File', async () => {
		const file = new File(['Hello'], 'hello.txt', { type: 'text/plain' })

		const response = mapResponse(file, createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Hello')
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
		await expect(response.json()).resolves.toEqual(body)
		expect(response.status).toBe(200)
	})

	it('maps Error to RFC 9457 problem details', async () => {
		const response = mapResponse(new Error('Hello'), createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'Hello'
		})
		expect(response.headers.get('content-type')).toBe(
			'application/problem+json'
		)
		expect(response.status).toBe(500)
	})

	it('map Response', async () => {
		const response = mapResponse(new Response('Shiroko'), createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom Response', async () => {
		const response = mapResponse(
			new CustomResponse('Shiroko'),
			createContext()
		)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Shiroko')
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
		await expect(response.text()).resolves.toEqual('Shiroko')
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf8'
		)
	})

	it('map custom class', async () => {
		const response = mapResponse(new Student('Himari'), createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual({
			name: 'Himari'
		})
		expect(response.status).toBe(200)
	})

	it('map primitive with custom context', async () => {
		const context = createContext()
		const response = mapResponse('Shiroko', context)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toBe('Shiroko')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(200)
	})

	it('map undefined with context', async () => {
		const context = createContext()
		const response = mapResponse(undefined, context)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(200)
	})

	it('map null with custom context', async () => {
		const context = createContext()
		const response = mapResponse(null, context)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('')
		expect(response.headers.toJSON()).toEqual(context.headers)
		expect(response.status).toBe(200)
	})

	it('map Function with custom context', async () => {
		const context = createContext()
		const response = await mapResponse(() => 1, context)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('1')
		expect(response.headers.toJSON()).toEqual({
			...context.headers
		})
		expect(response.status).toBe(200)
	})

	it('map Promise with custom context', async () => {
		const context = createContext()

		const body = {
			name: 'Shiroko'
		}

		const response = await mapResponse(
			new Promise((resolve) => resolve(body)),
			context
		)

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual(body)
		expect(response.headers.toJSON()).toEqual({
			...context.headers,
			'content-type': 'application/json;charset=utf-8'
		})
		expect(response.status).toBe(200)
	})

	it('map Error with custom context', async () => {
		const context = createContext()

		const response = mapResponse(new Error('Hello'), context)

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'Hello'
		})
		expect(response.headers.toJSON()).toEqual({
			...context.headers,
			'content-type': 'application/problem+json'
		})
		expect(response.status).toBe(500)
	})

	it('map Response with custom context', async () => {
		const context = createContext()

		const response = await mapResponse(new Response('Shiroko'), context)
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual(headers)
	})

	it('map Response and merge Headers', async () => {
		const context = createContext()

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
		await expect(response.text()).resolves.toEqual('Shiroko')
		// @ts-ignore
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
		await expect(response.text()).resolves.toBe('Shiroko')
		expect(response.status).toBe(418)
	})

	it('map redirect', async () => {
		const response = mapResponse(redirect('https://cunny.school', 302), {
			status: "I'm a teapot",
			headers: {
				Name: 'Sorasaki Hina'
			},
			cookie: {}
		})

		expect(response).toBeInstanceOf(Response)
		expect(response.status).toBe(302)
		// await expect(response.text()).resolves.toEqual('Shiroko')
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
		await expect(response.text()).resolves.toEqual('Hina')
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
		await expect(response.text()).resolves.toEqual('Hina')
		expect(response.headers.get('name')).toEqual('Sorasaki Hina')
		expect(response.headers.getAll('set-cookie')).toEqual([
			'name=hina',
			'affiliation=gehenna'
		])
	})

	it('map toResponse', async () => {
		const response = mapResponse(new Passthrough(), createContext())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('hi')
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

		// ? Auto appended by Bun. Read before formData() consumes the
		// body, which drops the lazily-materialised header.
		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
		await expect(response.formData()).resolves.toBeInstanceOf(FormData)
		expect(response.status).toBe(200)
	})

	it('map beforeHandle', async () => {
		const app = new Elysia()
			.mapResponse(() => {
				return new Response('b')
			})
			.get(
				'/',
				{
					beforeHandle() {
						return 'a'
					}
				},
				() => 'a'
			)

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('b')
	})

	it('map afterHandle', async () => {
		const app = new Elysia()
			.mapResponse(() => {
				return new Response('b')
			})
			.get(
				'/',
				{
					beforeHandle() {
						return 'a'
					}
				},
				() => 'a'
			)

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('b')
	})

	it('respect set.headers on string response', async () => {
		const app = new Elysia()
			.afterHandle(({ set }) => {
				set.headers['content-type'] = 'text/html; charset=utf8'

				return '<h1>Hina</h1>'
			})
			.get('/', () => 'a')

		const response = await app.handle('/')

		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf8'
		)
	})
})

describe('Web Standard - Map Response with untouched set', () => {
	const untouched = () => ({ headers: {} }) as any

	it('map string on an untouched set', async () => {
		const response = mapResponse('Shiroko', untouched())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toBe('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map object on an untouched set', async () => {
		const response = mapResponse({ name: 'Shiroko' }, untouched())

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual({ name: 'Shiroko' })
		expect(response.status).toBe(200)
	})

	it('write back set.status for ElysiaStatus on an untouched set', async () => {
		const set = untouched()
		const response = mapResponse(status(418, 'teapot'), set)

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('teapot')
		expect(set.status).toBe(418)
	})

	it('write back set.status for Promise<ElysiaStatus> on an untouched set', async () => {
		const set = untouched()
		const response = await mapResponse(
			Promise.resolve(status(418, 'teapot')),
			set
		)

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('teapot')
		expect(set.status).toBe(418)
	})

	it('maps ElysiaFile without mutating set.headers', async () => {
		const set = untouched()
		const response = await mapResponse(file('test/kyuukurarin.mp4'), set)

		expect(response.headers.get('content-type')).toBe('video/mp4')
		expect(response.headers.get('content-range')).toStartWith('bytes 0-')
		expect(Object.keys(set.headers)).toHaveLength(0)
	})

	it('writes stream headers back to an untouched set', async () => {
		const set = untouched()
		const response = await mapResponse(
			(function* () {
				yield 'a'
				yield 'b'
			})(),
			set
		)

		expect(response.headers.get('transfer-encoding')).toBe('chunked')
		await expect(response.text()).resolves.toBe('ab')
		expect(set.headers['transfer-encoding']).toBe('chunked')
	})

	it('takes the slow path for a prototype-chained set.headers, own keys only', async () => {
		// The slow path exists to strip a prototype off `set.headers`, so it
		// must not publish what it strips. `Object.assign(set.headers, body)`
		// in a handler reparents through the inherited `__proto__` setter, and
		// promoting inherited keys would turn a request body into real headers
		// — the platform itself reads own properties only
		// (`new Response(x, { headers })`), so a chain walk is Elysia being
		// more permissive than the runtime it wraps.
		const set = {
			headers: Object.assign(Object.create({ 'x-default': '1' }), {
				'x-own': '2'
			})
		} as any
		const response = mapResponse('Shiroko', set)

		expect(response.headers.get('x-own')).toBe('2')
		expect(response.headers.get('x-default')).toBeNull()
		await expect(response.text()).resolves.toBe('Shiroko')
	})

	it('write back set.status from a sync handler returning Promise<status()>', async () => {
		let observed: unknown

		const app = new Elysia()
			.afterResponse(({ set }) => {
				observed = set.status
			})
			.get('/', () => Promise.resolve(status(418, 'teapot')))

		const response = await app.handle('/')

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('teapot')

		await Bun.sleep(10)
		expect(observed).toBe(418)
	})
})
