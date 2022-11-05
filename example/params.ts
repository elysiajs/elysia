import { KingWorld } from '../src'

const app = new KingWorld()
	.get('/', () => 'KINGWORLD')
	// Retrieve params, automatically typed
	.get('/id/:id', ({ params }) => params.id)
	.listen(8080)

console.log('Listen')
