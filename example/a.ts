import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia().onAfterResponse(({ set, responseValue }) => {
	console.log(responseValue)
	console.log(set.status)
})
.listen(3000)
