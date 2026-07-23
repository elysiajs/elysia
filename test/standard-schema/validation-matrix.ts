import { expect } from 'bun:test'
import { post } from '../utils'

export const expectValidationMatrix = async (
	handle: (request: Request) => Promise<Response>
) => {
	const statuses = await Promise.all(
		[
			post('/lilith?limit=1', { id: 1 }),
			post('/fouco?limit=10', { id: 2 }),
			post('/unknown?limit=10', { id: 2 }),
			post('/fouco?limit=a', { id: 2 }),
			post('/fouco?limit=10', { id: '2' }),
			post('/fouco', {})
		].map((request) => handle(request).then((response) => response.status))
	)

	expect(statuses).toEqual([404, 418, 422, 422, 422, 422])
}
