import { Elysia } from '../src'
import { req } from '../test/utils'

let _i = 0

class A {
	public i: number

	constructor() {
		this.i = _i++
	}
}

const app = new Elysia()
	.decorate({
		a: '1'
	})
	.get('/', ({ a }) => a)

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
