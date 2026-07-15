import { Elysia } from '../src'

const app = new Elysia()
	.get('/', ({ server }) => {
		console.log(server?.requestIP.toString())

		return 'a'
	})
	.listen(3000)

app.handle('/')
fetch('http://localhost:3000')
