import { Elysia, HTTPError, problem } from '../src'

class Unauthorized extends HTTPError.id('Unauthorized', 401) {
	readonly detail = 'You are not authorized'
}
class InsufficientBalance extends HTTPError.id('INSUFFICIENT_BALANCE', 402) {
	extension() {
		return {
			detail: 'out of credit',
			balance: 0
		} as const
	}
}
class OutOfStock extends HTTPError.id('OUT_OF_STOCK', 409) {
	readonly detail = 'The item is out of stock'
}

const app = new Elysia()
	.macro({
		auth: {
			beforeHandle() {
				if (Math.random() > 0.5) return new Unauthorized()
			}
		}
	})
	.get(
		'/id/:id',
		{
			auth: true,
			beforeHandle() {
				if (Math.random() > 0) return new InsufficientBalance()
			},
			afterHandle() {
				if (Math.random() > 0.5) return new OutOfStock()
			}
		},
		({ params: { id } }) => `bought ${id}` as const
	)
	.listen(3000)

type app = (typeof app)['~Routes']['id'][':id']['get']['response']
