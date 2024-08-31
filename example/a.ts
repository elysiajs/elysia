import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', 'Static Content', {
	beforeHandle() {
		return 'beforeHandle'
	}
})
.listen(3000)

const response = await app.handle(req('/')).then((x) => x.text())

console.log(app.router.static.http.handlers[0])
