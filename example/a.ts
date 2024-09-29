import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ aot: false })
	.resolve(() => {
		return {
			hello: 'world'
		}
	})
	.get('/', ({ hello }) => hello)

const res = await app.handle(req('/')).then((x) => x.text())

console.log(res)
