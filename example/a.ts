import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get('/id/:id', 'a').listen(3000)

await app.handle(req('/id/123')).then((x) => x.text())
await app.handle(req('/id/123')).then((x) => x.text())
const res = await app.handle(req('/id/123')).then((x) => x.text())

console.log(res)
