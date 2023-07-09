import { Elysia, t, UnwrapSchema } from '../src'

const app = new Elysia()
	// .use(compression())
	.onAfterHandle(() => {
		console.log('S')
	})
