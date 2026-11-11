import { Elysia } from '../../../src'

// The secondary reuses the primary's name, its routes arrive async
export const app = new Elysia({ name: 'svc' }).get('/', () => 'ok')
export const other = new Elysia({ name: 'svc', seed: 1 }).use(
	import('./multi-app-async-routes')
)
