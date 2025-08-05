// test.test.ts
import { describe, it, expect } from 'bun:test'
import { Elysia } from 'elysia'

const setApp = new Elysia()
	.onRequest(({ set }) => {
		set.headers['x-header'] = 'test'
		set.status = 400
	})
	.get('/', 'yay')
	.get('/func', () => 'yay')

const responseApp = new Elysia()
	.onRequest(() => {
		return new Response('nope', {
			status: 400,
			headers: {
				'x-header': 'test'
			}
		})
	})
	.get('/', 'yay')
	.get('/func', () => 'yay')

async function expectResponse(
	response: Response,
	exp: { status: number; header: string; body: string }
) {
	expect(response.status).toBe(exp.status)
	expect(response.headers.get('x-header')).toBe(exp.header)
	expect(await response.text()).toBe(exp.body)
}

const setExp = {
	status: 200,
	header: 'test',
	body: 'yay'
}

const responseExp = {
	status: 400,
	header: 'test',
	body: 'nope'
}

describe('Elysia', () => {
	it('setApp - /', async () => {
		const response = await setApp.handle(new Request('http://localhost/'))
		await expectResponse(response, setExp)
	})

	it('setApp - /func', async () => {
		const response = await setApp.handle(
			new Request('http://localhost/func')
		)
		await expectResponse(response, setExp)
	})

	// it('responseApp - /', async () => {
	// 	const response = await responseApp.handle(
	// 		new Request('http://localhost/')
	// 	)
	// 	await expectResponse(response, responseExp)
	// })

	// it('responseApp - /func', async () => {
	// 	const response = await responseApp.handle(
	// 		new Request('http://localhost/func')
	// 	)
	// 	await expectResponse(response, responseExp)
	// })
})
