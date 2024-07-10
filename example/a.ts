import { Elysia, t } from '../src'
import { req } from '../test/utils'
import { AsyncLocalStorage } from 'async_hooks'

const store = new AsyncLocalStorage()

const plugin = new Elysia()
	.wrap((fn) => store.run({ a: 1 }, () => AsyncLocalStorage.bind(fn)))

const app = new Elysia()
	.use(plugin)
	.use(plugin)
	.use(plugin)
	.get('/a', () => {
		console.log('A', store.getStore())
		return 'a'
	})
	.compile()

console.log(app.fetch.toString())

app.handle(req('/a'))
	.then((x) => x.text())
	.then(console.log)
