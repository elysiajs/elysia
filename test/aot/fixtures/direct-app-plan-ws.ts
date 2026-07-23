import { Elysia, t } from '../../../src'

export const app = new Elysia().ws('/ws', {
	body: t.Object({ message: t.String() }),
	message() {}
})
