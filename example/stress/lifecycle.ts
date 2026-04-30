import { Elysia } from '../../src/2'
import { profile } from './utils'

const total = 100_000
const plugins = new Array(total)

for (let i = 0; i < total; i++)
	plugins[i] = new Elysia().beforeHandle('plugin', () => {})

const stop = profile('Elysia 2α apply 100k plugins w/ 1 event')
const app = new Elysia()

for (let i = 0; i < total; i++) app.use(plugins[i])

app.get('/', () => 'ok')
// await app
// 	.handle('/')
// 	.then((res) => res.text())

// console.log(app['~ext'])
stop()
