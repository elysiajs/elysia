import Elysia, { NotFoundError, t } from '../src'
import { req } from '../test/utils'

const route = new Elysia().get('/', ({ status }) => status(102)).listen(3000)

let response = await route.handle(req('/'))

console.log(await response.text())
