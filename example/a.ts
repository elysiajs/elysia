import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get(
		'/update',
		({ cookie: { name } }) => {
			if (!name.value) throw new Error('Cookie required')

			console.log(name.value)

			name.value = 'seminar: Rio'
			console.log(name.value)

			name.value = 'seminar: Himari'
			name.value = ''

			name.maxAge = 86400
			name.add({
				domain: 'millennium.sh',
				httpOnly: true
			})

			return name.value
		},
		{
			cookie: t.Object({
				name: t.TemplateLiteral(
					'seminar: ${Rio | Yuuka | Noa | Koyuki}'
				)
			})
		}
	)
	.get(
		'/council',
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Adminstration'
				},
				{
					name: 'Momoka',
					affilation: 'Transportation'
				},
			]),
		{
			cookie: t.Object({
				council: t.Array(
					t.Object({
						name: t.String(),
						affilation: t.String()
					})
				)
			})
		}
	)
	.get('/remove', ({ cookie }) => {
		for (const self of Object.values(cookie)) self.remove()

		return 'Deleted'
	})
	.listen(3000)
