import { Elysia, t, EXPOSED } from '../src'

const app = new Elysia()
	.setModel({
		number: t.Number()
	})
	.post(
		'/',
		({ set, body: { status, response } }) => {
			set.status = status

			return response
		},
		{
			schema: {
				body: t.Object({
					status: t.Number(),
					response: t.Any()
				}),
				response: {
					200: t.String(),
					201: t.Number()
				}
			}
		}
	)
	.group('/group', (app) =>
		app.ws('/websocket', {
			message(ws, message) {
				ws.send(message)
			},
			schema: {
				body: t.String()
			}
		})
	)
	.listen(3000)

// console.log({
// 	// @ts-ignore
// 	route: app.router.history,
// 	// @ts-ignore
// 	wsRoute: app.wsRouter?.history,
// })
