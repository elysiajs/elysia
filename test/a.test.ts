import { Elysia } from '../src'
import { it, expect } from 'bun:test'

it('DELETE requests returns 400 for no reason', async () => {
	const app = new Elysia()
		// I am doing group parse: ['application/json'] becouse I dont want to paste parse: ['application/json'] on every API
		.group(
			'user',
			{ parse: 'application/json', detail: { tags: ['Users'] } },
			(group) =>
				group
					.delete('/:id', ({ params: { id } }) => {
						return id
					}, {
						parse: 'none'
					})
					.get('/', () => ({
						id: '123',
						name: 'John Doe'
					}))
			// and 10 GETs more..
		)
		.listen(3000)

	const responseForGet = await app.handle(
		new Request('http://localhost/user', { method: 'GET' })
	)
	expect(responseForGet.status).toBe(200)

	const responseForDelete = await app.handle(
		new Request('http://localhost/user/123', { method: 'DELETE' })
	)
	// 👇 this is weird
	expect(responseForDelete.status).toBe(400)
})
