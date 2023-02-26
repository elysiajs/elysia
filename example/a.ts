import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
    .setModel({
        name: t.Object({
            name: t.String()
        })
    })
	.get('/', (context) => context[SCHEMA])
    .post('/any', ({ body: { name } }) => name, {
        schema: {
            body: 'name',
            response: t.String()
        }
    })
	.listen(8080)

type App = typeof app['meta'][typeof SCHEMA]['/any']['POST']['body']
