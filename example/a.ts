import { Elysia, t } from '../src'

new Elysia()
	.onStart(({ server }) => {
		console.log(`${server?.url}:${server?.port}`)
	})
	.listen(1234, (a) => {

	})
