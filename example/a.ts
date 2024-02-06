import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const a = new Elysia().get('a', 'a')
const b = new Elysia().get('b', 'b')

const app = new Elysia().guard({})

app._routes