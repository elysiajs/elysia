import { Elysia, t } from '../src'
import { Memoirist } from 'memoirist'

const app = new Elysia({ systemRouter: true })
	.get('/id', ({ params }) => 'ok')
	.post('/id', 'a')
	.listen(3000)
