import { Elysia, file, status, t } from '../src'

const inner = new Elysia()
	.get('/plugin', new Response('ok'))
