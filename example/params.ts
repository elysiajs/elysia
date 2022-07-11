import KingWorld from '../src'

const app = new KingWorld()
    .get('/', () => 'KINGWORLD')
    .get<{
        params: {
            id: number
        }
    }>('/id/:id', ({ params }) => params.id || 'No Params')
    .listen(8080)

console.log('Listen')
