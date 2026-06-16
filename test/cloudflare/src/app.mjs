import { Elysia, t } from 'elysia'
export const app = new Elysia()
	.get('/', () => 'Elysia frozen on Cloudflare Worker!')
	// `afterResponse` exercises the post-flush scheduler in the frozen handler. On
	// workerd there's no `setImmediate`, so the runtime check must fall back to
	// `Promise.resolve().then` — if it baked `setImmediate`, this route would crash.
	.post('/echo', ({ body }) => body, {
		body: t.Object({ n: t.Number() }),
		afterResponse() {}
	})
export default { fetch: (request) => app.handle(request) }
