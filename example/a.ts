import { Elysia } from '../src'

const app = new Elysia()
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)
