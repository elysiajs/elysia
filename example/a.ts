import { Elysia } from '../src'

const app = new Elysia({ precompile: true })
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)

console.log(app.routes[0].composed?.toString())
