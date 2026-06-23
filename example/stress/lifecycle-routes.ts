import { Elysia } from '../../src'
import { profile } from './utils'

const total = 30_000
const plugins = new Array(total)

for (let i = 0; i < total; i++)
	plugins[i] = new Elysia()
		.beforeHandle('plugin', () => {})
		.get(`/r${i}`, () => 'ok')

const stop = profile(
	'Elysia 2α full build 30k plugins w/ 1 route + global event then fetch\n'
)
const app = new Elysia()

for (let i = 0; i < total; i++) app.use(plugins[i])

app.handle('/r0')

stop()
