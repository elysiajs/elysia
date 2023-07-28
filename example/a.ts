import { Elysia, t } from '../src'
import { cookie } from '@elysiajs/cookie'

const group = new Elysia({ prefix: '/v1' })
	.use(cookie())
	.get('/cookie', () => 'Hi')

const app = new Elysia()
	.use(cookie())
	.use(group)
	.get('/', () => 'Mutsuki need correction 💢💢💢')

console.log(app.routes[0].path)
console.log(app.routes[0].hooks.transform.map((x) => x.$elysiaChecksum))
