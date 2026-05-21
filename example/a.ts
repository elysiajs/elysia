import { Elysia, t } from '../src'

const plugin = new Elysia({ prefix: 'v1' }).get('thing', 'thing')

const app = new Elysia({ prefix: 'api' }).use(plugin)

console.log(app.routes[0].path)

// This should not error
app['~Routes']?.api.v1.thing
