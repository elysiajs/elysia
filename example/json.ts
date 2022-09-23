import Kingworld from 'kingworld'

new Kingworld()
	.get('/', () => ({
		hello: 'world'
	}))
	.listen(8080)
