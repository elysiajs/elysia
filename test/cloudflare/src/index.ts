import { Elysia, t } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'

const sub = new Elysia().get('/test', () => 'hello')

export default new Elysia({ adapter: CloudflareAdapter })
	.get('/', () => 'Elysia on Cloudflare Worker!')
	.use(sub)
	.compile()
