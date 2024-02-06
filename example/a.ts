import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get('/', () => {
    if(Math.random() > 0.5) return error(418, 'a')

    return false
})

app._routes[''].get.response
