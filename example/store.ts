import { KingWorld } from '../src'

new KingWorld()
	// Create globally mutable store
	.state('name', 'Fubuki')
	.get('/id/:id', ({ params: { id }, store: { name } }) => `${id} ${name}`)
