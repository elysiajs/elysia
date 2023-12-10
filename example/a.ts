import { Elysia, t } from '../src'

const a = new Elysia({ name: 'a', seed: 'awdawd' }).extends(
	({ onBeforeHandle }) => ({
		a(fn: string) {
			onBeforeHandle(() => {
				console.log(fn)
			})
		}
	})
)
const b = new Elysia({ name: 'b', seed: 'add' }).use(a).decorate('b', 'b')

// const app = new Elysia()
// 	.use(a)
// 	.use(b)
// 	.get('/', () => 'Hello World', {
// 		a: 'a'
// 	})
// 	.listen(3000)

const orders = []

const app = new Elysia()
	.extends(({ onBeforeHandle }) => ({
		hi(fn: () => any) {
			onBeforeHandle(fn)
		}
	}))
	.onBeforeHandle(() => {
		orders.push(1)
	})
	.get('/', () => 'Hello World', {
		beforeHandle() {
			orders.push(2)
		},
		hi: () => {
			orders.push(3)
		}
	})

console.log(app.routes[0])
app.handle(new Request('http://localhost/'))
// console.dir({ main: app.dependencies }, { depth: 10 })
