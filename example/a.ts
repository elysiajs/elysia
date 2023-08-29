import { Elysia, t } from '../src'

const b = (app: Elysia) => app.model('B', t.String()).get('/', () => 'A')

const app = new Elysia()
    .model({
        A: t.String()
    })
    // .use(b)
    .get(
        '/id/:id',
        (context) => {
            return {
                a: 'A'
            }
        },
        {
            body: 'A',
            response: t.Object({
                a: t.String()
            })
        }
    )

type A = typeof app

// .use(
// 	new Elysia({ prefix: '/test', scoped: true })
// 		.derive(() => {
// 			console.log('test')
// 			return { test: 'test' }
// 		})
// 		.get('/', ({ test }) => test)
// )
// .use(new Elysia({ prefix: '/asdf' }).get('/', () => 'asdf'))

// new Elysia().use(app).listen(3000)
