import KingWorld from '../src'

new KingWorld()
	.post<{
		body: {
			id: number
			username: string
		}
	}>(
		'/',
		async ({ body }) => {
			const { username } = await body

			return `Hi ${username}`
		},
		{
			transform: (request) => {
				request.body = request.body.then((user) => {
					user.id = +user.id

					return user
				})
			}
		}
	)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
