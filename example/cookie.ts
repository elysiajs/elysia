import KingWorld from 'kingworld'

new KingWorld()
	.get('/', ({ responseHeaders }) => {
		responseHeaders.append('set-cookie', 'val1=1')
		responseHeaders.append('set-cookie', 'val2=2')

		return 'Hi'
	})
	.listen(3000)
