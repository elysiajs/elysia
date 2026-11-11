import { Elysia } from '../../../src'

// An unnamed, unexported mounted sub-app gets no manifest of its own: the
// build succeeds, and `inner.handle` fails its first request in an AOT process.
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
