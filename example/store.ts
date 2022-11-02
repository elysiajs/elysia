import KingWorld from '../src'

new KingWorld()
	.state('name', 'Fubuki')
	.get('/id/:id', ({ params: { id }, store: { name } }) => `${id} ${name}`)
