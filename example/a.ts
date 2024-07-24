import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { req } from '../test/utils'

const expected = [{ a: 'b' }, 1, ['a', 1, { a: 'b' }]]
const expectedResponse = JSON.stringify(expected)
let i = 0

const app = new Elysia().get('/', async function* () {
	yield expected[0]
	await Bun.sleep(10)

	yield expected[1]
	await Bun.sleep(10)

	yield expected[2]
})

const response = await app
	.handle(req('/'))
	.then((x) => x.body)
	.then((x) => {
		if (!x) return

		const reader = x?.getReader()

		let acc = ''
		const { promise, resolve } = Promise.withResolvers()

		reader.read().then(function pump({ done, value }): unknown {
			if (done) return resolve(acc)

			console.log(value.toString(), JSON.stringify(expected[i++]))

			return reader.read().then(pump)
		})

		return promise
	})
