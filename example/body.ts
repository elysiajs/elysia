import KingWorld from '../src'

new KingWorld()
	.get('/', () => new Response('a'))
	.post<{
		body: {
			id: number
			username: string
		}
	}>('/', async ({ body: { username } }) => {
		return `Hi ${username}`
	})
	.post<{
		body: {
			id: number
			username: string
		}
	}>(
		'/transform',
		async ({ body }) => {
			const { username } = await body

			return `Hi ${username}`
		},
		{
			transform: (request) => {
				request.body.id = +request.body.id
			}
		}
	)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
