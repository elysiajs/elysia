import { Elysia, status, t } from '../src'
import z from 'zod'

const app = new Elysia()
	.as('global')
	.get('/', ({ body, status }) =>
		Math.random() > 0.05 ? status(409) : ('Hello World' as const)
	)

type A = (typeof app)['~Routes']['get']['response']
