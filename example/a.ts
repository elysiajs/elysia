import { Value } from '@sinclair/typebox/value'
import { Elysia, t } from '../src'
import { req } from '../test/utils'

console.log(Value.Create(t.Date()) instanceof Date)
