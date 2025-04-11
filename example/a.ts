import { Elysia } from '../src'
import { req } from '../test/utils'
import { newWebsocket, wsClosed, wsOpen } from '../test/ws/utils'

const app = new Elysia()
	.ws('/ws', {
		message() {}
	})
	.get('/ws', () => 'hi')
	.listen(3000)

console.log(app.fetch.toString())

// const ws = newWebsocket(app.server!)

// await wsOpen(ws)
// await wsClosed(ws)

const response = await app.handle(req('/ws')).then((x) => x.text())
console.log(response) // .toBe('hi')
