import { Elysia } from '../../../src'

// `mount()` forwards to a separate Elysia instance that compiles its routes
// lazily at request time, so the mounted routes are invisible to AOT capture.
// strip:'auto' MUST therefore skip stubbing handler JIT; otherwise the mounted
// route 500s at runtime ("handler compiler JIT was stripped").
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
