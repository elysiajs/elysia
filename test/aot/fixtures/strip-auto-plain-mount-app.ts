import { Elysia, t } from '../../../src'

// better-auth style: `.mount()` of a plain fetch function, no Elysia router
const auth = {
	handler: (request: Request) =>
		new Response('auth ' + new URL(request.url).pathname)
}

export const app = new Elysia()
	.mount('/auth', auth.handler)
	.post('/user', { body: t.Object({ name: t.String() }) }, ({ body }) => body)
