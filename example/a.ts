import { Elysia, t } from '../src'
import { z } from 'zod'

const app = new Elysia()
	.model({
		sign: t.Object({
			username: t.String(),
			password: t.String()
		}),
		zodSign: z.object({
			username: z.string(),
			password: z.string()
		})
	})

// For TypeBox
// const zodSign = app.models.zodSign.Schema()
// type zodSign = z.infer<typeof zodSign>
//    ^?


console.log(app.models.sign.schema)
