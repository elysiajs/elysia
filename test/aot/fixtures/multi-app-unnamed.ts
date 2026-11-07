import { Elysia } from '../../../src'

// The issue verbatim: an unnamed `api` is not captured, so only `app` has a
// manifest, and `api` building its own router fails loud
export const api = new Elysia({ prefix: '/api' }).get('/state', () => ({
	theme: 'system'
}))

export const app = new Elysia().use(api)

export default app
