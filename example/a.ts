import Compile from 'typebox/compile'
import { ElysiaValidator } from '../src/schema/validator'
import { hasType, hasTypes } from '../src/schema/utils'
import { t } from '../src/type-system'
import { z } from 'zod'
import { coerceRoot } from '../src/schema/coerce'

const a = t.Object({
	hello: t.String()
})

const q = new ElysiaValidator(a, {
	coerces: coerceRoot(),
	schemas: [
		t.Object({
			a: t.Number()
		}),
		t.Object({
			b: t.String()
		}),
		t.Accelerate(
			z.object({
				c: z.string()
			})
		)
	]
})
