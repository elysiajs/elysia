import KingWorld from '../src'

new KingWorld()
	.get('/', () => 'Hi')
	.onStart(() => {
		console.log('🦊 KINGWORLD is running at :8080')
	})
	.listen(8080)
