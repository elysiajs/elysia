import KingWorld from '../src'

new KingWorld()
	.state('awd', 'a')
	.get('/', () => 'Hi')
	.guard(
		{
			preHandler: ({ query }) => {
				if (!query.name) return 'Query name is required'
			}
		},
		(app) =>
			app.get<{
				query: {
					name: string
				}
			}>('/profile', ({ query: { name } }) => `Hi ${name}`)
	)
	.listen(3000)
