import { Elysia } from '../src'

class Test {
	readonly name = 'test'

	public foo() {
		return this.name
	}
}

const test = new Test()

console.log(test)

export const ctx = new Elysia().decorate('test', test)

const app = new Elysia()
	.use(ctx)
	.get('/', ({ test }) => {
		console.log(test)
		console.log(test.foo())
	})
	.listen(3002)

console.log(`app is listening on ${app.server?.hostname}:${app.server?.port}`)

app.handle(new Request('http://localhost:3002/'))
