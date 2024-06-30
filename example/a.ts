import { Elysia, t } from '../src'
import { separateFunction } from '../src/sucrose'
import { post, req } from '../test/utils'

const plugin = new Elysia().get('/', () => 'hello')

const main = new Elysia().use(plugin).get('/2', () => 'hi')

console.log(main.getGlobalRoutes())