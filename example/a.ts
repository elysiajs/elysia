import { Elysia } from '../src'

const app = new Elysia()
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get('/update', ({ cookie: { name } }) => {
		if (!name.value) throw new Error('Cookie required')

		console.log(name.value)
		console.log((name.value = 'Rio'))

		name.maxAge = 86400
		name.add({
			domain: 'millennium.sh',
			httpOnly: true
		})

		return name.value
	})
	.get('/remove', ({ cookie: { name } }) => {
		name.remove()

		return 'Deleted'
	})
	.listen(3000)
