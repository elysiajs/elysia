import { Elysia, t } from '../../../src'

export default new Elysia()
	.ws('/typed', {
		body: t.Object({ message: t.String() }),
		message() {}
	})
	.ws('/plain', {
		message() {}
	})
