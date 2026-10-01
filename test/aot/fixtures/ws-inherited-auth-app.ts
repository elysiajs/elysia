import { Elysia, status } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

const deny = ({ request }: { request: Request }) =>
	request.headers.get('cookie') === 'session=ok'
		? undefined
		: status(401, 'Unauthorized')

// An inherited auth hook guarding a WS route that lives in a plugin
export const app = new Elysia()
	.use(websocket())
	.beforeHandle(deny)
	.use(
		new Elysia()
			.get('/http', () => 'ok')
			.ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
	)
