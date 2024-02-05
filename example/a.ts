import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	// .onError(() => 'handled')
	.onRequest(() => {
		throw new Error('error')
	})
	.get('/', 'Static Content')

const response = await app.handle(req('/')).then((x) => x.text())
