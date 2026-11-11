import { Elysia } from 'elysia'
import { z } from 'zod'

export const app = new Elysia()
	.get('/plain', () => 'loser')
	.get('/plain', () => 'winner')
	.get('/standard', { response: z.string() }, () => 'loser')
	.get('/standard', { response: z.string() }, () => 'winner')
