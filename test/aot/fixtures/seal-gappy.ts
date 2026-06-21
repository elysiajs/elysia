import { Elysia, t } from '../../../src'

// a WebSocket route can't be AOT-frozen → coverage gap → best-effort degrades
export default new Elysia()
	.post('/ok', { body: t.Object({ a: t.String() }) }, ({ body }) => body)
	.ws('/chat', { body: t.Object({ msg: t.String() }), message() {} })
