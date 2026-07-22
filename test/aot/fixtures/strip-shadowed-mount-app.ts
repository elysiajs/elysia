import { Elysia } from '../../../src'

const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.mount('/sub', inner.handle)
	.all('/sub', () => 'winner')
	.all('/sub/*', () => 'winner')
