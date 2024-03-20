import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).onError(({ code }) => {
	if (code === 'NOT_FOUND') return 'UwU'
})

const response = await app.handle(req('/not/found'))

console.log(app.handleError.toString())

console.log(await response.text())
