import { Elysia, t } from 'elysia'

// DEFECT 1 (macro schema): a macro that contributes a `body` schema injects it
// under `hook.schemas` (not the named `body` slot). Same refusal surface as the
// standalone guard → must be `wired`, never `sealed`.
const plugin = new Elysia().macro({
	withBody: {
		body: t.Object({ name: t.String() })
	}
})

export const app = new Elysia()
	.use(plugin)
	.post('/u', { withBody: true } as any, ({ body }) => body)
