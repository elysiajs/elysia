import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
    .setModel({
        name: t.Object({
            name: t.String()
        })
    })
	.get('/', (context) => context[SCHEMA])
	.get('/a', (context) => context[SCHEMA])
	.listen(8080)

type App = typeof app['meta'][typeof SCHEMA]