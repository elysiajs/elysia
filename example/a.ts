import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get('/', () => 'hello world').listen(3000)

console.log(app.routes[0].compile().toString())
