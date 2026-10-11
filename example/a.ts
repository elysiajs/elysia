import { Elysia } from '../src'

new Elysia()
	.onBeforeHandle('global', () => {
		console.log("morning")
	})
	.listen(3000)
