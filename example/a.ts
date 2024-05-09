import { Elysia, t } from '../src'
import { req, post } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(async ({ parse, transform, beforeHandle, context }) => {
		{
			const { end, time } = await parse
			console.log('Parse', (await end) - time)
		}

		{
			const { end, time } = await transform
			console.log('Transform', (await end) - time)
		}

		{
			const { end, time } = await beforeHandle
			console.log('Before Handle', (await end) - time)
		}
	})
	.get(
		'/',
		(context) => {
			console.log("A")

			return 'a'
		},
		{
			beforeHandle() {
				// await new Promise((r) => setTimeout(r, 10))
			},
			error({ error }) {
				console.log(error)
			}
		}
	)

// console.log(app.routes[0].composed.toString())

await app.handle(req('/')).then((x) => x.text())
// .then(console.log)

// console.log(app.event.trace[0].fn)
