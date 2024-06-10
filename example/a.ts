import { Elysia } from '../src'

let _i = 0

class A {
	public i: number

	constructor() {
		this.i = _i++
	}
}

const app = new Elysia()
	.decorate('a', new A())
	.decorate('a', new A())

console.log(app.decorator.a.i)