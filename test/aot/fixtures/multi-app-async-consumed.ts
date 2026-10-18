import { Elysia } from '../../../src'

// Neither the named plugin nor the group child is exported, so only `app` has
// a manifest: it merges their async routes and serves them from its own
const api = new Elysia({ name: 'api', prefix: '/api' }).use(
	import('./multi-app-async-routes')
)

export const app = new Elysia({ name: 'app' })
	.use(api)
	.group('/v1', (v1) => v1.use(import('./multi-app-async-routes')))
	.get('/', () => 'ok')

// `app.handle()` serves what is merged so far, it doesn't wait for modules
export const settle = () => app.modules.then(() => new Response('settled'))
