import { Elysia, t } from '../src'
import { t as t2 } from '../dist'
import { Validator } from '../src/validator'

new Elysia().get('/', {}, new Response('Q'))
