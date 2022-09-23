import KingWorld from '../src'

new KingWorld()
	.get('/', ({ request }) => {
		console.log("A", request.url)

		return 'Hi'
	})
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
