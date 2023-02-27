import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
    .get('/', (context) => context[SCHEMA])
    .post('/a', (context) => context[SCHEMA], {
        'schema': {
            'body': t.Array(t.File()),
            detail: {}
        }
    })
	.get('/b', (context) => context[SCHEMA], {
        'schema': {
            'body': t.Files({
                "maxItems": 3,
                "minSize": '1m'
            }),
            detail: {}
        }
    })
	.listen(8080)

type App = typeof app['meta'][typeof SCHEMA]