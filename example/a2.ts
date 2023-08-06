import { Elysia, t } from '../src'
import { cookie } from '@elysiajs/cookie'

const a = (app: Elysia) =>
	app.group('/hello', (app) =>
		app
			.use(cookie())
			.get('/hello', () => 'Hello')
			.get('/hello2', () => 'Hello')
	)

const app = new Elysia()
	.use(cookie())
	.use(a)
	.get('/cookie', () => 'Hi')
