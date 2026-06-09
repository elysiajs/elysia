import { Elysia } from 'elysia'

new Elysia()
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)
