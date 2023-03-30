import { Elysia, t, EXPOSED, SCHEMA } from '../src'

const isProduction = process.env.NODE_ENV === 'production'

const app = new Elysia().if(isProduction, (app) =>
	app.get('/registered', () => 'hi')
)

type App = typeof app
