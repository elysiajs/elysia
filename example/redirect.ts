import { KingWorld } from '../src'

new KingWorld()
	.get('/', () => 'Hi')
	.get('/redirect', ({ set }) => {
		set.redirect = '/'
	})
	.listen(8080)
