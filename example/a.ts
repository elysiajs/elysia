import { Elysia, MaybeArray, status, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.onBeforeHandle(() => {
		if (Math.random() > 0.5) return 'a' as const
	})
	.get('/', () => 'b' as const)

app['~Volatile']['response']
app['~Routes']['get']['response']
