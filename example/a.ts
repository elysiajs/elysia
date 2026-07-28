import { Elysia, file } from '../src'
import { WebStandardAdapter } from '../src/adapter/web-standard'

const app = new Elysia()
	.get('/', file('test/kyuukurarin.mp4'))
	.listen(3000)
