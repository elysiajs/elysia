import { Elysia, t } from '../src'
import { req } from '../test/utils'

new Elysia()
  .onError(({ code, error }) => {
	if(code === "VALIDATION")
		return code
  })
  .get('/query', () => {
	return 'a'
  }, {
	query: t.Object({
		a: t.String()
	})
  })
  .listen(3000)