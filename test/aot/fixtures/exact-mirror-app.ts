import { Elysia, t } from '../../../src'

// Sealable, so `strip: 'auto'` reaches sealed mode and `strip: false` does not.
export const app = new Elysia()
	.post(
		'/u',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
