import { Elysia, t } from '../../../src'

// WS-only app WITH schemas: captures WS validator entries (the seal evidence)
// but zero HTTP handlers. All slots bridge-free → mode A (sealed).
export default new Elysia().ws('/chat', {
	body: t.Object({ message: t.String() }),
	query: t.Object({ room: t.Number() }),
	response: t.Object({ echo: t.String() }),
	message(ws, body) {
		ws.send({ echo: (body as any).message })
	}
})
