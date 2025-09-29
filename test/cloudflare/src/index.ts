import { Elysia, t } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'

export default new Elysia({
	adapter: CloudflareAdapter
})
	.get('/', () => 'Elysia on Cloudflare Worker!')
	.post('/mirror', ({ body }) => body, {
		body: t.Object({
			hello: t.String()
		})
	})
	.compile()
