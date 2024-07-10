import { Elysia, t } from '../src'
import { req } from '../test/utils'
import { AsyncLocalStorage } from 'async_hooks'

const store = new AsyncLocalStorage()

const plugin = new Elysia()
	.trace(({ onHandle }) => {
		onHandle(() => {
			console.log('A')
		})
	})
	.get('/plugin', () => 'ok')

const app = new Elysia().use(plugin).get('/main', () => typeof store.getStore())

await app
	.handle(req('/plugin'))

await app
	.handle(req('/main'))
