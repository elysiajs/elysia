import { t } from '../src'
import { Elysia } from '../src/base'

import Schema from 'typebox/schema'

const a = t.Object(
	{
		a: t.String(),
		b: t.Number()
	},
	{
		additionalProperties: false
	}
)

console.log(
	Schema.Compile(a).Errors({
		a: 'b',
		c: 'a'
	})
)
