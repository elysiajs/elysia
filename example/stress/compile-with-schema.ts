import { Elysia, t } from '../../src'
import { profile } from './utils'

const total = 40_000
const stacks = <any[]>Array(total)

const stop = profile('Elysia 2α full compile x40k')

for (let i = 0; i < total; i++) {
	const app = new Elysia().get(`/${i}`, () => 'ok', {
		body: t.Object({
			name: t.String(),
			age: t.Number()
		})
	})

	app.handler(0, true)
	app.fetch

	stacks[i] = app
}

stop()
