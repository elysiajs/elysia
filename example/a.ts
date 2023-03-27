import { Elysia, t, EXPOSED, SCHEMA } from '../src'

const isProduction = process.env.NODE_ENV === 'production'

const app = new Elysia()
	.setModel({
		number: t.Number()
	})
	.get('/', () => 'hi', {
		schema: {
			body: 'number'
		}
	})
	.if(isProduction, (app) =>
		app.get('/registered', () => 'hi', {
			schema: {
				body: 'number'
			}
		})
	)

type App = typeof app
