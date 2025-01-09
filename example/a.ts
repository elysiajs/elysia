import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', 'Static Content')

console.log(app.router.static.http.static['/'])
