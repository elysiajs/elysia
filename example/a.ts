import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => 'ok')
	.listen(3000)

app.handle('/')
