import { Elysia } from '../../../src'

// Mounted routes compile lazily outside the captured root. Automatic stripping
// serves the captured route, while the uncaptured mounted route cannot compile.
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
