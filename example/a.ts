import { Elysia, t } from '../src'
import { req } from '../test/utils'

const plugin = new Elysia()

const app = new Elysia().use(plugin).get('/', ({ store }) => store)

// const res = await app.handle(req('/')).then((r) => r.json())
// expect(res).toEqual({
// 	name: 'Ina'
// })
