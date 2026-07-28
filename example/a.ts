import { Elysia } from '../src'
import { WebStandardAdapter } from '../src/adapter/web-standard'

const subapp = new Elysia({
	adapter: WebStandardAdapter
}).ws('/', function* () {
	yield 'OK'
	yield 'Hello WebSocket'
})

const app = new Elysia({
	adapter: WebStandardAdapter
})
	.get('/', 'ok')
	.use(subapp)
