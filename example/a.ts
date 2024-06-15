import { Elysia, t } from '../src'

const main = new Elysia()
	.post('/', ({ set }) => {
		set.headers.accept = 'application/json;q=1'
	}, {
		body: t.Object({
			ticketId: t.String({
				description: 'Ticket ID to redeem'
			}),
			email: t.String({ format: 'email' })
		})
	})
	.get('/json', () => ({
		hello: 'world'
	}))
