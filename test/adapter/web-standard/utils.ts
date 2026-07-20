import { expect, it } from 'bun:test'

export class Passthrough {
	toResponse() {
		return this.custom
	}

	get custom() {
		return 'hi'
	}
}

class Student {
	constructor(public name: string) {}

	toString() {
		return JSON.stringify({ name: this.name })
	}
}

class CustomResponse extends Response {}

export const testCommonResponseMapping = (
	map: (value: any) => Response | Promise<Response>
) => {
	for (const [name, value, body] of [
		['string', 'Shiroko', 'Shiroko'],
		['number', 1, '1'],
		['boolean', true, 'true'],
		['function', () => 1, '1'],
		['undefined', undefined, ''],
		['null', null, '']
	] as const)
		it(`map ${name}`, async () => {
			const response = await map(value)

			expect(response).toBeInstanceOf(Response)
			await expect(response.text()).resolves.toBe(body)
			expect(response.status).toBe(200)
		})

	it('map object', async () => {
		const body = { name: 'Shiroko' }
		const response = await map(body)

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual(body)
		expect(response.status).toBe(200)
	})

	it('map Blob', async () => {
		const file = Bun.file('./test/images/aris-yuzu.jpg')
		const response = await map(file)

		expect(response).toBeInstanceOf(Response)
		await expect(response.arrayBuffer()).resolves.toEqual(
			await file.arrayBuffer()
		)
		expect(response.status).toBe(200)
	})

	it('map File', async () => {
		const response = await map(
			new File(['Hello'], 'hello.txt', { type: 'text/plain' })
		)

		expect(response).toBeInstanceOf(Response)
		await expect(response.text()).resolves.toEqual('Hello')
		expect(response.status).toBe(200)
	})

	it('map Promise', async () => {
		const body = { name: 'Shiroko' }
		const response = await map(Promise.resolve(body))

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual(body)
		expect(response.status).toBe(200)
	})

	it('maps Error to RFC 9457 problem details', async () => {
		const response = await map(new Error('Hello'))

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

	for (const [name, value] of [
		['Response', new Response('Shiroko')],
		['custom Response', new CustomResponse('Shiroko')]
	] as const)
		it(`map ${name}`, async () => {
			const response = await map(value)

			expect(response).toBeInstanceOf(Response)
			await expect(response.text()).resolves.toEqual('Shiroko')
			expect(response.status).toBe(200)
		})

	it('map custom class', async () => {
		const response = await map(new Student('Himari'))

		expect(response).toBeInstanceOf(Response)
		await expect(response.json()).resolves.toEqual({ name: 'Himari' })
		expect(response.status).toBe(200)
	})
}
