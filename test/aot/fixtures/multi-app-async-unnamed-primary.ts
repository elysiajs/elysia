import { Elysia } from '../../../src'

// A named secondary whose routes arrive async still makes a multi-app build
export const api = new Elysia({ name: 'api' }).use(
	import('./multi-app-async-routes')
)

export const app = new Elysia().get('/', () => 'ok')
