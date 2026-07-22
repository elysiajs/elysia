import { Elysia } from '../../../src'

// Mounted routes compile lazily outside the captured root, so automatic
// stripping must retain handler JIT for the uncaptured inner app.
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
