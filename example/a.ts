import { Elysia, t, InferHandler, file } from '../src'

new Elysia()
	.get('/file', file('public/takodachi.png'))
