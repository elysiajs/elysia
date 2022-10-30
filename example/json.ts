import Kingworld from '../src'

new Kingworld()
	.get('/', () => ({
		hello: 'world'
	}))
	.post('/json', ({ body }) => body)
	.listen(8080)
