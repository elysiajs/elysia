import { Elysia, t } from '../src'
import { Hono } from 'hono'

const elysia = new Elysia()
	.get('/', () => 'Hello from Elysia inside Hono inside Elysia!')
	.get('/id/:id', ({ params: { id } }) => id)

const hono = new Hono()
	.get('/', ({ text }) => text('Hello from Hono!'))
	.get('/id/:id', ({ text, req }) => text(req.param('id')))
	.mount('/elysia', elysia.fetch)

const main = new Elysia()
	.get('/', () => 'Hello from Elysia!')
	.get('/id/:id', ({ params: { id } }) => id)
	.mount(hono.fetch)
	.listen(3000)
