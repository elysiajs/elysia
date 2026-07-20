import { Elysia, t } from '../../../src'

export default new Elysia()
	.get(
		'/single',
		{ response: t.Object({ value: t.String() }) },
		() => ({ value: 'ok' })
	)
	.get(
		'/multi',
		{
			response: {
				200: t.Object({ ok: t.Boolean() }),
				404: t.Object({ error: t.String() })
			}
		},
		() => ({ ok: true })
	)
