import { Elysia, t } from '../src'
import { Reconcile } from '../src/types'
import { req } from '../test/utils'

class A {
	get a() {
		return this
	}
}

type E = Reconcile<A, {}>

const app = new Elysia().get('/*', ({ params }) => 'hi')

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
