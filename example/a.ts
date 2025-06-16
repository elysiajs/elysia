import { Elysia, t } from '../src'
import homepage from './index.html'

new Elysia({ aot: false })
	.post('/test', () => 'Hello World', { body: t.Object({}) })
