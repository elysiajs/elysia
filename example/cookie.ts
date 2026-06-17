import { Elysia, t } from '../src'

const app = new Elysia({
	cookie: {
		secrets: 'Fischl von Luftschloss Narfidort',
		sign: 'name'
	}
})
	.get(
		'/council',
		{
			cookie: t.Cookie({
				council: t.Array(
					t.Object({
						name: t.String(),
						affilation: t.String()
					})
				)
			})
		},
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Administration'
				}
			])
	)
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get(
		'/update',
		{
			cookie: t.Cookie({
				name: t.Optional(t.String())
			})
		},
		({ cookie: { name } }) => {
			name.value = 'seminar: Rio'
			name.value = 'seminar: Himari'
			name.maxAge = 86400

			return name.value
		}
	)
	.listen(3000)
