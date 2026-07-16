import { Elysia } from 'elysia'

export const app = new Elysia()

setTimeout(() => {
	if ((app as { ['~generation']?: unknown })['~generation'] === undefined)
		app.get('/late', () => 'late')
}, 0)
