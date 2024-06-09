import { Elysia, t } from '../src'
import { expectTypeOf } from 'expect-type'
import { req } from '../test/utils'

const app = new Elysia().get('/', async function* () {
	yield 'a'
	await Bun.sleep(10)

	yield 'b'
	await Bun.sleep(10)

	yield 'c'
})

// console.log(app.routes[0].composed?.toString())

const controller = new AbortController()

setTimeout(() => {
	controller.abort()
}, 15)

app.handle(
	new Request('http://e.ly', {
		signal: controller.signal
	})
)
	.then((x) => x.body)
	.then((x) => {
		if (!x) return

		const reader = x?.getReader()

		let acc = ''
		const { promise, resolve } = Promise.withResolvers()

		reader.read().then(function pump({ done, value }): unknown {
			if (done) return resolve(acc)

			acc += value.toString()
			console.log(value.toString())
			return reader.read().then(pump)
		})

		return promise
	})
	.then((x) => console.log('Result:', x))
