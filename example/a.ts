import { Elysia, t } from '../src'

const plugin = new Elysia()
	.onAfterHandle({ as: 'scoped' }, (x) => {
		console.log(x.response)
		return 'From AfterHandle'
	})

new Elysia()
	.use(plugin)
	.get('/', () => 'From Index')
	.listen(4848)
