import { Elysia, t } from '../src'

using plugin = new Elysia().get('a', 'a')

const main = new Elysia().use(plugin)

main.listen(3000)
