import { Elysia, t } from '../src'
import { req } from '../test/utils'

const plugin = new Elysia().trace({ as: 'scoped' }, () => {
})

const parent = new Elysia().use(plugin)

const main = new Elysia().use(parent).get('/', () => 'h')

main.handle(req('/'))
