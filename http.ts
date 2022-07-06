import KingWorld from './index'

const app = new KingWorld()

app.get('/', () => 'KINGWORLD')
    .get('/kw', () => 'KINGWORLD')
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
    .default(
        () =>
            new Response('Not Found :(', {
                status: 404
            })
    )
    .listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
