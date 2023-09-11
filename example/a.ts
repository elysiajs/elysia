import { Elysia, t } from '../src'

const app = new Elysia({
	cookie: {
		secret: ['A', 'B']
	}
})
	// .get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	// .get(
	// 	'/update',
	// 	({ cookie: { name } }) => {
	// 		if (!name.value) throw new Error('Cookie required')

	// 		console.log(name.value)

	// 		name.value = 'seminar: Rio'
	// 		console.log(name.value)

	// 		name.value = 'seminar: Himari'
	// 		name.value = ''

	// 		name.maxAge = 86400
	// 		name.add({
	// 			domain: 'millennium.sh',
	// 			httpOnly: true
	// 		})

	// 		return name.value
	// 	},
	// 	{
	// 		cookie: t.Object({
	// 			name: t.String()
	// 		})
	// 	}
	// )
	.model(
		'council',
		t.Cookie(
			{
				council: t.Array(
					t.Object({
						name: t.String(),
						affilation: t.String()
					})
				)
			},
			{
				secrets: ['e'],
				sign: ['council']
			}
		)
	)
	.get(
		'/council',
		({ cookie: { council } }) => {
			council.value = [
				{
					name: 'Rin',
					affilation: 'Adminstration'
				},
				{
					name: 'Momoka',
					affilation: 'Transportation'
				}
			]

			return 'ok'
		},
		{
			cookie: 'council'
		}
	)
	// .get('/remove', ({ cookie }) => {
	// 	for (const self of Object.values(cookie)) self.remove()

	// 	return 'Deleted'
	// })
	.listen(3000)

// console.log(app.routes.at(-1)?.composed?.toString())

const a = <const T extends Readonly<string[]>>(a: T): T => a

a(['a', 'b'])
