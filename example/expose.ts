import { Elysia, EXPOSED } from '../src'

const app = new Elysia()
	.state('store', () => new Date())
	.decorate('decorator', () => new Date())
	.fn({
		mirror: (value: number) => value,
		sum: (a: number, b: number) => a + b
	})
	.listen(8080)

console.log(
	await app
		.handle(
			new Request('http://localhost/~fn', {
				method: 'POST',
				headers: {
					'content-type': 'elysia/fn'
				},
				body: JSON.stringify({
					json: [
						{
							n: ['mirror'],
							p: [1]
						},
						{
							n: ['mirror'],
							p: [1]
						},
						{ n: ['sum'], p: [1, 2] }
					],
					meta: {}
				})
			})
		)
		.then((x) => x.text())
)
