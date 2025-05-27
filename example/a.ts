import { Elysia, t } from '../src'

const MessageSchema = t.Object({
	message: t.String()
})

const app = new Elysia({
	name: 'appService'
})
	.model({
		message: MessageSchema
	})
	.get(
		'/health',
		() => {
			return {
				timestamp: new Date().toISOString(),
				status: 'ok'
			}
		},
		{
			response: {
				200: t.Object({
					status: t.String(),
					timestamp: t.String()
				}),
				default: t.Ref('message')
			}
		}
	)

app.handle(new Request('http://localhost/health'))
	.then((x) => x.json())
	.then(console.log)
