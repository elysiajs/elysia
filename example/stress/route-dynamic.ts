import { Elysia } from '../../src'
import { profile } from './utils'

const app = new Elysia()

const total = 100_000
const stop = profile('Elysia 2α add route x100k + fetch once')

for (let i = 0; i < total; i++) app.get(`/:id/${i}`, () => 'ok')

// full build
app.handle('/0')

stop()
