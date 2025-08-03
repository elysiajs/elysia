import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.mapResponse(({ set }) => {
		set.headers['content-type'] = 'text/plain'
	})
	.get('/', new Response('ok'))
	.listen(3000)
