import { Elysia } from '../../../src'

// Both the root and mounted handler must be reachable from the direct image.
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
