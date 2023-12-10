import { describe, it, expect } from 'bun:test'
import { mapCompactResponse } from '../../src/handler'
import { Passthrough } from './utils'

class Student {
	constructor(public name: string) {}
}

describe('Map Compact Response', () => {
	it('map string', async () => {
		const response = mapCompactResponse('Shiroko')

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map number', async () => {
		const response = mapCompactResponse(1)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map boolean', async () => {
		const response = mapCompactResponse(true)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('true')
		expect(response.status).toBe(200)
	})

	it('map object', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = mapCompactResponse(body)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json<any>()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map function', async () => {
		const response = mapCompactResponse(() => 1)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toBe('1')
		expect(response.status).toBe(200)
	})

	it('map undefined', async () => {
		const response = mapCompactResponse(undefined)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map null', async () => {
		const response = mapCompactResponse(null)

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('')
		expect(response.status).toBe(200)
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')

		const response = mapCompactResponse(file)

		expect(response).toBeInstanceOf(Response)
		expect(await response.arrayBuffer()).toEqual(await file.arrayBuffer())
		expect(response.status).toBe(200)
	})

	it('map Promise', async () => {
		const body = {
			name: 'Shiroko'
		}

		const response = await mapCompactResponse(
			new Promise((resolve) => resolve(body))
		)

		expect(response).toBeInstanceOf(Response)
		expect(await response.json<any>()).toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map Error', async () => {
		const response = mapCompactResponse(new Error('Hello'))

		expect(response).toBeInstanceOf(Response)
		expect(await response.json<any>()).toEqual({
			name: 'Error',
			message: 'Hello'
		})
		expect(response.status).toBe(500)
	})

	it('map Response', async () => {
		const response = mapCompactResponse(new Response('Shiroko'))

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.status).toBe(200)
	})

	it('map custom class', async () => {
		const response = mapCompactResponse(new Student('Himari'))

		expect(response).toBeInstanceOf(Response)
		expect(await response.json<any>()).toEqual({
			name: 'Himari'
		})
		expect(response.status).toBe(200)
	})

	it('map Response and merge Headers', async () => {
		const response = mapCompactResponse(
			new Response('Shiroko', {
				headers: {
					Name: 'Himari'
				}
			}),
		)
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('Shiroko')
		expect(response.headers.toJSON()).toEqual({
			...headers,
			name: 'Himari'
		})
	})

	it('map Passthrough', async () => {
		const response = mapCompactResponse(new Passthrough())

		expect(response).toBeInstanceOf(Response)
		expect(await response.text()).toEqual('hi')
		expect(response.status).toBe(200)
	})

	it('map video content-range', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const response = mapCompactResponse(kyuukararin)

		expect(response).toBeInstanceOf(Response)
		expect(response.headers.get('accept-ranges')).toEqual('bytes')
		expect(response.headers.get('content-range')).toEqual(
			`bytes 0-${kyuukararin.size - 1}/${kyuukararin.size}`
		)
		expect(response.status).toBe(200)
	})
})
