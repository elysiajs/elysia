import KingWorld, { type Plugin } from './index'

const app = new KingWorld()

const plugin: Plugin<{ prefix?: string }> = (app, { prefix = '/fbk' } = {}) => {
    app.group(prefix, (app) => {
        app.get('/plugin', () => 'From Plugin')
    })
}

app.register(plugin)
    .get('/', () => 'KINGWORLD')
    .get('/kw', () => 'KINGWORLD', {
        preHandlers: ({ query }) => {
            if (query?.name === 'aom') return 'Hi saltyaom'
        }
    })
    .get('/id/:id', ({ params, query }) => {
        console.log({
            params,
            query
        })

        return params.id
    })
    .get('/json', () => ({
        hi: 'world'
    }))
    .group('/group', (app) => {
        app.when('preHandler', ({ query }) => {
            if (query?.name === 'aom') return 'Hi saltyaom'
        })
            .get('/hi', () => 'HI GROUP')
            .get('/kingworld', () => 'Welcome to KINGWORLD')
            .get('/fbk', () => 'FuBuKing')
    })
    .default(
        () =>
            new Response('Not Found :(', {
                status: 404
            })
    )
    .listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
