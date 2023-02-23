import { Elysia } from '../src'
import { Redis } from 'ioredis'

class A {
	name: string

	constructor(name: string) {
		this.name = name
	}

	getName() {
		return this.name
	}
}

const app = new Elysia()
	.fn(({ permission }) => ({
		ping: () => 'pong',
		v: permission({
			value: (a: string) => {},
			check({ key, params }) {}
		}),
		nested: {
			data: () => 'hi'
		},
		mirror: <T>(a: T) => a,
		redis: permission({
			value: new Redis(),
			allow: ['get', 'set'],
			check({ key, params, match }) {
				return match({
					default() {
						throw new Error('Forbidden')
					}
				})
			}
		}),
		authorized: permission({
			value: () => 'Hi',
			check({ request: { headers }, match }) {
				if (!headers.has('Authorization'))
					throw new Error('Authorization is required')
			}
		}),
		b: permission({
			value: {
				allow: () => true,
				deny: () => false
			},
			allow: ['allow'],
			check({ match }) {
				return match({
					default() {
						throw new Error('Denied')
					}
				})
			}
		}),
		a: permission({
			value: {
				allow: <T>(a: T) => a,
				deny: () => false
			},
			allow: ['allow'],
			check({ match }) {
				return match({
					allow([param]) {
						if (param === true) throw new Error('Forbidden Value')
					}
				})
			}
		})
	}))
	.listen(8080)

await app
	.handle(
		new Request('http://localhost/~fn', {
			method: 'POST',
			headers: {
				'content-type': 'elysia/fn',
				Authorization: 'Ar1s'
			},
			body: JSON.stringify({
				json: [
					{
						n: ['a', 'allow'],
						p: [true]
					},
					{
						n: ['a', 'allow'],
						p: ["any"]
					},
					// {
					// 	n: ['b', 'allow']
					// },
					// {
					// 	n: ['b', 'deny']
					// }
					// { n: ['redis', 'set'], p: ['hi', 'awa'] },
					// { n: ['redis', 'get'], p: ['hi'] }
				],
				meta: {}
			})
		})
	)
	.then((x) => x.text())
	.then(console.log)
