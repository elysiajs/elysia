import { describe, it, expect } from 'bun:test'

import { mapCompactResponse } from '../../../src/adapter/web-standard/handler'
import { form } from '../../../src/utils'
import { Passthrough, testCommonResponseMapping } from './utils'

describe('Web Standard - Map Compact Response', () => {
	testCommonResponseMapping(mapCompactResponse)

	it('map Response and merge Headers', async () => {
		const response = await mapCompactResponse(
			new Response('Shiroko', {
				headers: {
					Name: 'Himari'
				}
			})
		)

		// @ts-ignore
		const headers = response.headers.toJSON()

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Shiroko')
		// @ts-ignore
		expect(response.headers.toJSON()).toEqual({
			...headers,
			name: 'Himari'
		})
	})

	it('map toResponse', async () => {
		const response = mapCompactResponse(new Passthrough())

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('hi')
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

	it('map formdata', async () => {
		const response = mapCompactResponse(
			form({
				a: Bun.file('test/kyuukurarin.mp4')
			})
		)!

		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
		expect(response.status).toBe(200)
		await expect(response.formData()).resolves.toBeInstanceOf(FormData)
	})

	it('map custom thenable', async () => {
		// Custom thenable object (e.g., like some ORMs return such as Drizzle)
		// Using a class to avoid being caught by the 'Object' case
		class CustomThenable {
			then(onFulfilled: (value: any) => any) {
				const data = { name: 'Shiroko', id: 42 }
				return Promise.resolve(data).then(onFulfilled)
			}
		}

		const customThenable = new CustomThenable()
		const responsePromise = mapCompactResponse(customThenable)
		expect(responsePromise).toBeInstanceOf(Promise)

		const response = await responsePromise

		expect(response).toBeInstanceOf(Response)
		const body = await response.text()
		const parsed = JSON.parse(body)
		expect(parsed).toEqual({ name: 'Shiroko', id: 42 })
		expect(response.status).toBe(200)
	})
})
