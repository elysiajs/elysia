import { Elysia } from '../../src'
import { profile } from './utils'

const total = 100_000
const plugins = new Array(total)

for (let i = 0; i < total; i++)
	plugins[i] = new Elysia().get(`/${i}`, () => 'ok')

const stop = profile('Elysia 2α apply 100k plugins w/ 1 route')
const app = new Elysia()

for (let i = 0; i < total; i++) app.use(plugins[i])

// app.handle('/')
stop()
