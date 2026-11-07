import { Elysia } from '../../../src'

// `api` has no route until its async module settles: the build must wait for
// it, or `api` is not captured and fails at runtime for want of a manifest
export const api = new Elysia({ name: 'api', prefix: '/api' }).use(
	import('./multi-app-async-routes')
)

export const app = new Elysia({ name: 'app' }).get('/', () => 'ok')
