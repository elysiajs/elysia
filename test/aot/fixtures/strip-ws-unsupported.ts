import { Elysia } from '../../../src'

// Ambient lifecycle state is deliberately outside the compact local-hook image.
export default new Elysia()
	.beforeHandle(() => {})
	.ws('/ws', { message: () => {} })
