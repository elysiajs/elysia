import { Elysia, t } from '../src'
import { req } from '../test/utils'

const plugin = new Elysia().get('/plugin', 'static ')
