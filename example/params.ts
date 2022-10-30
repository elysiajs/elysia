import KingWorld from '../src'

const app = new KingWorld()
	.get('/', () => 'KINGWORLD')
	.get('/id/:id', ({ params }) => params.id || 'No Params')
	.listen(8080)

console.log('Listen')
