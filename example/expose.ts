import { Elysia, EXPOSED } from '../src'

const app = new Elysia()
	.state('store', () => new Date())
	.decorate('decorator', () => new Date())
	.fn(({ decorator, store: { store } }) => ({
		mirror: (value: any) => value,
		decorator,
		store,
		nested: {
			data() {
				return 'a'
			}
		}
	}))
	.fn(({ permission }) => ({
		prisma: permission({
			value: {
				users: {
					create() {
						return 'ok'
					},
					delete() {
						return 'ok'
					}
				}
			},
			allow({ key, params, request: { headers } }) {
				if (key === 'users.delete' && headers.get('Authorization'))
					throw new Error('Forbidden')
			}
		})
	}))
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
						{ n: ['nested', 'data'] },
						{
							n: ['invalid']
						}
						// { n: ['prisma', 'users', 'create'], p: 'a' },
						// { n: ['prisma', 'users', 'delete'], p: 'a' }
						// { n: ['mirror'], p: 29301 },
						// { n: ['a'] },
						// { n: ['decorator'], p: '' },
						// { n: ['store'] },
						// { n: ['nested', 'data'] },
					],
					meta: {}
				})
			})
		)
		.then((x) => x.text())
)
