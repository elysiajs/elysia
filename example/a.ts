import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia({ precompile: true }).get('/id', ({ query: { id } }) => id).ws('/ws', {

}).compile()

console.log(app.router.static.http.handlers[1].toString())

// await app.handle(req('/id/123'))
// await app.handle(req('/id/123'))
// await app.handle(req('/id/123'))
// const res = await app.handle(req('/id/123')).then((x) => x.text())

// console.log(app.fetch.toString())
