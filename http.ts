import KingWorld, { type Plugin } from './index'

import S from 'fluent-json-schema'

const plugin: Plugin<
    { prefix?: string },
    {
        fromPlugin: 'a'
    }
> = (app, { prefix = '/fbk' } = {}) =>
    app.state('fromPlugin', 'a').group(prefix, (app) => {
        app.get('/plugin', () => 'From Plugin')
    })

const app = new KingWorld<{
    a: string
    id: number
}>()

app.use(plugin)
    .state('id', Math.random())
    .get('/', () => 'KINGWORLD')
    .use((app) =>
        app.group('/nested', (app) => app.get('/awawa', (_, store) => 'Hi'))
    )
    .get('/kw', () => 'KINGWORLD', {
        preHandler: ({ query }, store) => {
            if (query?.name === 'aom') return 'Hi saltyaom'
        }
    })
    .get(
        '/id/:id',
        ({ params, query }, store) => {
            console.log({
                params,
                query
            })

            return params.id
        },
        {
            preValidate(request, store) {
                request.params.id = +request.params.id
            },
            schema: {
                
            }
        }
    )
    .get('/json', () => ({
        hi: 'world'
    }))
    .post(
        '/body/a',
        async ({ request }) => {
            return 'Hi'
        },
        {
            schema: {
                body: S.object().prop(
                    'username',
                    S.string().required().minLength(5)
                )
            }
        }
    )
    .group('/group', (app) => {
        app.preHandler(({ query }) => {
            if (query?.name === 'aom') return 'Hi saltyaom'
        })
            .get('/hi', () => 'HI GROUP')
            .get('/kingworld', () => 'Welcome to KINGWORLD')
            .get('/fbk', () => 'FuBuKing')
    })
    .get('/identity', (_, store) => {
        return store.id
    })
    .default(
        () =>
            new Response('Not Found :(', {
                status: 404
            })
    )
    .listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
