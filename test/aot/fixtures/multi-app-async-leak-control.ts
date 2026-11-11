import { Elysia, t } from '../../../src'

// multi-app-async-leak.ts without the hidden sub-app
export const app = new Elysia({ name: 'app' })
	.use(import('./multi-app-async-plugin'))
	.post(
		'/b',
		{ body: t.Object({ data: t.String(), role: t.String() }) },
		({ body }) => body
	)
