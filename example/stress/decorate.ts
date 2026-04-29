import { Elysia, t } from '../../src/2'
import { profile } from './utils'

const app = new Elysia()
const total = 100_000
const sub = 10

const stop = profile('Merge decoration x100k with 10 sub-decorations')

for (let i = 0; i < total; i++) {
	const plugin = new Elysia()

	for (let j = 0; j < sub; j++)
		plugin.decorate('a', {
			[`value-${i * sub + j}`]: 1
		})

	app.use(plugin)
}

stop()
