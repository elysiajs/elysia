import { Elysia, t } from '../src'

new Elysia()
	// .onError(({ code, error, set }) => {
	// 	switch (code) {
	// 		case 'NOT_FOUND':
	// 			set.status = 404

	// 			return 'Not Found :('

	// 		case 'VALIDATION':
	// 			set.status = 400

	// 			return {
	// 				fields: error.all
	// 			}
	// 	}
	// })
	.post('/a', async () => 'hi', {
		body: t.Object({
			username: t.String(),
			password: t.String(),
			nested: t.Optional(
				t.Object({
					hi: t.String()
				})
			)
		}),
		error({ error }) {
			console.log(error)
		}
	})
	.listen(3000)
