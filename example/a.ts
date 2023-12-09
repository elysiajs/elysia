import { Elysia, t } from '../src'

const app = new Elysia()
	.ws('/ws', {
		message() {}
	})
	// .listen(0)
