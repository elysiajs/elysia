import { Elysia, t } from 'elysia'

export const app = new Elysia()
	.get('/', () => 'Elysia frozen on Cloudflare Worker!')
	.post(
		'/echo',
		{
			body: t.Object({ n: t.Number() }),
			// test afterHandle
			afterResponse() {}
		},
		({ body }) => body
	)

export default { fetch: (request) => app.handle(request) }
