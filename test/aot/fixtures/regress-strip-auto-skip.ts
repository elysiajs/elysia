import { Elysia } from '../../../src'

// A WS route reaches no handler-JIT entry point, so strip:'auto' must probe the
// HTTP routes' real result (stubbable) instead of blanket-skipping. The JIT
// graph is stubbed while the WS runtime module is retained (`ws:false`).
export const app = new Elysia()
	.get('/', () => 'ok')
	.ws('/ws', { message: () => {} })
