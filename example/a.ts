import { Elysia } from '../src'

const nextDay = () => new Date(Date.now() + 86400 * 1000)

const app = new Elysia()
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get('/update', ({ cookie: { name } }) => {
		if (!name.value) throw new Error('Cookie required')

		name.expires = nextDay()
		name.add({
			domain: 'millennium.sh',
			httpOnly: true
		})

		return 'Updated'
	})
	.get('/remove', ({ cookie: { name } }) => {
		name.remove()

		return 'Deleted'
	})
	.listen(3000)
