import { Elysia } from '../src'

export interface AuthData {
	id: number
}

const a = new Elysia().decorate({
	thing: {
		a: []
	}
})

const b = new Elysia()
	.decorate({
		thing: {
			a: ''
		}
	})
	.use(a)
	.listen(3000)
