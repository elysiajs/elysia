import { Elysia, t } from '../src'

const OnlyStrongPassword = new Elysia()
	.guard({
		body: t.Object(
			{ password: t.Literal('strong-password') },
			{ additionalProperties: true }
		),
		beforeHandle() {
			console.log('Checking password...')
		}
	})
	.as('plugin')

const app = new Elysia()
	.use(OnlyStrongPassword)
	.guard({
		body: t.Object(
			{ username: t.Literal('Jhon') },
			{ additionalProperties: true }
		),
		beforeHandle() {
			console.log('Checking name...')
		}
	})
	.post('/test', ({ body }) => {
		return 'Hello ' + body.username
	})
	.listen(3000)

const response = await app
	.handle(
		new Request('http://localhost/test', {
			// notice how password is wrong
			body: JSON.stringify({
				password: 'weak-password',
				username: 'Jhon'
			}),
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		})
	)
	.then((res) => res.text())

console.log(response)
