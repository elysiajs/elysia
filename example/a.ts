import { Elysia, t } from '../src'
import { req } from '../test/utils'


const app = new Elysia()
			// @ts-ignore
			.onRequest(({ qi }) => {
				// queryIndex = qi
				console.log("A", qi)
			})
			.get('/', () => 'ok')
			.listen(0)

		await fetch(`http://localhost:${app.server?.port}`)
