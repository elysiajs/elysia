import { Elysia, t } from '../src'
import Page from './index.html'

new Elysia()
	.get('/', Page)
	.get('/mika.mp4', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)
