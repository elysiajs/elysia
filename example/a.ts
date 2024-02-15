import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

// @ts-expect-error
const app = new Elysia().get('/', () => '1', {
    response: t.Number()
})

const response = await app.handle(req('/'))

console.log(response.headers.toJSON())
