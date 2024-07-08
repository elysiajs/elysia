import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).trace(() => {}).get('/', () => {

})

console.log(app.routes[0].composed?.toString())
