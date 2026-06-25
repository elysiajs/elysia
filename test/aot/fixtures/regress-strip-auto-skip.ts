import { Elysia } from '../../../src'

// WS forces handler JIT to stay reachable, so strip:'auto' must SKIP all
// stubbing here and leave a normal, working bundle.
export const app = new Elysia()
	.get('/', () => 'ok')
	.ws('/ws', { message: () => {} })
