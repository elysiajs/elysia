import Elysia, { t } from '../src'

const plugin = new Elysia({ prefix: 'v1' }).get('thing', 'thing')

const app = new Elysia({ prefix: 'api' }).use(plugin).listen(3000)

console.log(app.routes)

app['~Routes']?.api.v1.thing
