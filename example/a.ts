import { Elysia } from '../src'
import * as z from 'zod'

const app = new Elysia().post(
	'/hello',
	{
		query: z.object({ number: z.coerce.number() }),
		body: z.object({ number: z.coerce.number() })
	},
	() => {}
)

type App = typeof app

type Query = App['~Routes']['hello']['post']['query']
// actual: { number: number; }
// expected: { number: string; }

type Body = App['~Routes']['hello']['post']['body']
// actual: { number: number; }
// expected: { number: string; }
