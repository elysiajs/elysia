import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().group('inbox', (app) =>
	app.ws('join', {
		body: t.Object({
			inboxId: t.String()
		}),
		message(ws, { inboxId }) {
			ws.send(inboxId)
		}
	})
).listen(3000)

// const response = await app.handle(req('/a')).then((x) => x.text())
// console.log(response)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
