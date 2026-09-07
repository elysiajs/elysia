import { Elysia, t } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// Bridge-free WebSocket schema slots allow a WebSocket-only app to seal.
export default new Elysia().use(websocket()).ws('/chat', {
	body: t.Object({ message: t.String() }),
	query: t.Object({ room: t.Number() }),
	response: t.Object({ echo: t.String() }),
	message(ws, body) {
		ws.send({ echo: (body as any).message })
	}
})
