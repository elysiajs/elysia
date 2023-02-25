import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
	.get('/', (context) => context[SCHEMA])
    .post('/any', ({ body: { name } }) => name, {
        schema: {
            body: t.Object({
                name: t.String()
            }),
            response: t.String()
        }
    })
	.listen(8080)
