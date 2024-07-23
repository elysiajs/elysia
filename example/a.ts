import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { req } from '../test/utils'

const main = new Elysia({ aot: false }).get('/', () => {})

const resp = await main.handle(new Request('http://localhost/')).then(x => x.status)
console.log(resp)