import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
    .setModel({
        name: t.Object({
            name: t.String()
        })
    })
	.get('/', (context) => context[SCHEMA])
    .post('/any', ({ body }) => body, {
        schema: {
            body: 'name',
            response: 'name'
        }
    })
	.listen(8080)

type App = typeof app['meta'][typeof SCHEMA]['/any']['POST']['response']
