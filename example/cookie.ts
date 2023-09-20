import { Elysia, getSchemaValidator, t } from '../src'

const app = new Elysia()
	// .get(
	// 	'/council',
	// 	({ cookie: { council } }) =>
	// 		(council.value = [
	// 			{
	// 				name: 'Rin',
	// 				affilation: 'Administration'
	// 			}
	// 		])
	// )
	// .get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get(
		'/update',
		({ cookie: { name } }) => {
			name.value = 'seminar: Rio'

			name.value = 'seminar: Himari'

			name.maxAge = 86400

			return name.value
		},
		{
			cookie: t.Cookie(
				{
					name: t.Optional(t.String())
				},
				{
					secrets: 'Fischl von Luftschloss Narfidort',
					sign: ['name']
				}
			)
		}
	)
	// .get('/remove', ({ cookie }) => {
	// 	for (const self of Object.values(cookie)) self.remove()

	// 	return 'Deleted'
	// })
	.listen(3000)
