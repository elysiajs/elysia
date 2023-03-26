import { Elysia, ws, t } from '../src'

const app = new Elysia()
	.use(ws())
	.get('/', () => 'Welcome to Elysia!')
	.ws('/websocket', {
		message(ws, message) {
			ws.send(message)
		},
		schema: {
			body: t.String()
		}
	})
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
