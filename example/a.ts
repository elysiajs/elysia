import { Elysia, file } from '../src'
import { delay, req } from '../test/utils'

const app = new Elysia()
	.trace(({ onHandle, onAfterResponse }) => {
		onHandle(({ onStop }) => {
			onStop(({ error }) => {
				console.log("DONE")
			})
		})

		onAfterResponse(() => {
			console.log("DONE 2")
		})
	})
	.get('/', async function* () {
		for (let i = 0; i < 1000; i++) {
			yield `${i}`
			await delay(1)
		}
	})
	.listen(3000)
