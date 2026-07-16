import { Elysia, t } from 'elysia'

// Macro-provided schemas live under hook.schemas and require wired validation.
const plugin = new Elysia().macro({
	withBody: {
		body: t.Object({ name: t.String() })
	}
})

export const app = new Elysia()
	.use(plugin)
	.post('/u', { withBody: true } as any, ({ body }) => body)
