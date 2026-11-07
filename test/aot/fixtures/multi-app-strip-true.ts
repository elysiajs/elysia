import { Elysia } from '../../../src'

// `api` keeps handler JIT reachable (an indexed duplicate), `app` does not:
// the shared bundle must keep the JIT for both
export const api = new Elysia({ name: 'api' })
	.get('/d', () => 'first')
	.get('/d', () => 'second')

export const app = new Elysia({ name: 'app' }).get('/', () => 'ok')
