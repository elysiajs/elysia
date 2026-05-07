import { Elysia } from '../../src'
import { profile } from './utils'

const total = 100_000
const plugins = new Array(total)

for (let i = 0; i < total; i++)
	plugins[i] = new Elysia()
		.beforeHandle('plugin', () => {
			console.log(i)
		})
		.get(`/r${i}`, () => 'ok')

const stop = profile('Elysia 2α apply 10k plugins w/ 1 event + 1 route')
const app = new Elysia()

for (let i = 0; i < total; i++) app.use(plugins[i])

stop()
