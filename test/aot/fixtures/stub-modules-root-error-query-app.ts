import { Elysia } from '../../../src'

// Registered after the route, the error hook only runs on the app-level path
// (404), where it reads the lazily parsed `query` no route program aliases
export const app = new Elysia()
	.get('/', 'Hello World')
	.onError(({ query }) => `missing ${query.q}`)
