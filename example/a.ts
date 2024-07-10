import { Elysia, t } from '../src'
import { req } from '../test/utils'
import { AsyncLocalStorage } from 'async_hooks'

const store = new AsyncLocalStorage()

const plugin = new Elysia({ asyncLocalStorage: store })
	.get('/plugin', () => typeof store.getStore())

const app = new Elysia().use(plugin).get('/main', () => typeof store.getStore())

await app
	.handle(req('/plugin'))
	.then(x => x.text())
	.then(console.log)

await app
	.handle(req('/main'))
	.then(x => x.text())
	.then(console.log)
