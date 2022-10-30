import KingWorld from '../src'

new KingWorld()
	.get<{
		params: {
			name: string
		}
	}>('/name/:name', ({ params: { name } }) => name)
	.preHandler<{
		params: {
			name?: string
		}
	}>(({ params: { name } }) => {
		if (name === 'fubuki') return 'cat'
	})
	.listen(8080)
