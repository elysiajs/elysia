import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app1 = new Elysia()
	.get('/', async function* () {
		for (let i = 0; i < 100_000; i++) {
			await Bun.sleep(500)
			yield 'a'
		}
	})
	.listen(3001)

const app2 = new Elysia()
	.get('/', () => app1.handle(req('/')))
	.listen(3000)
