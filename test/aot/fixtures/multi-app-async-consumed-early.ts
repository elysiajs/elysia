import { Elysia } from '../../../src'

// multi-app-async-consumed.ts where `api` handles a request before its module
// settles: in an AOT process that build throws, `api` has no manifest
const api = new Elysia({ name: 'api', prefix: '/api' })
	.get('/early', () => 'early')
	.use(import('./multi-app-async-routes'))

try {
	await api.handle('/api/early')
} catch {}

export const app = new Elysia({ name: 'app' }).use(api).get('/', () => 'ok')

export const settle = () => app.modules.then(() => new Response('settled'))
