import { Elysia } from '../src'

const app = new Elysia()
	.trace(async ({ onBeforeHandle, onAfterHandle }) => {
		await onBeforeHandle(async ({ name, start, stop, children }) => {
			for (const onStart of children)
				onStart(async ({ name, start, stop }) => {
					console.log(name, start, '->', await stop, 'ms')
				})

			console.log('beforeHandle took', (await stop) - start, 'ms')
		})

		await onAfterHandle(async ({ name, start, stop, children }) => {
			for (const onStart of children)
				onStart(async ({ name, start, stop }) => {
					console.log(name, start, '->', await stop, 'ms')
				})

			console.log('afterHandle took', (await stop) - start, 'ms')
		})
	})
	.get('/', 'okkkk XD', {
		beforeHandle: [
			async function a() {
				await Bun.sleep(100)
			},
			async function b() {
				await Bun.sleep(150)
			}
		]
	})

import { req } from '../test/utils'
app.handle(req('/')).then((x) => x.text())
