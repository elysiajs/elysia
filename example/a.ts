import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(async ({ beforeHandle }) => {
		const { children, end } = await beforeHandle
		for(const child of children) {
			const { time, end, name } = await child
			console.log(name, 'took', await end - time, 'ms')
		}
	})
	.get(
		'/',
		() => {
			return 'a'
		},
		{
			async beforeHandle() {
				await Bun.sleepSync(500)
			}
		}
	)
	.compile()

console.log(app.routes[0].composed?.toString())
app.handle(req('/'))
	.then((x) => x.text())
// 	.then(console.log)
