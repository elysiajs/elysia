import { Elysia, t } from 'elysia'
import { Union } from 'typebox/type'

const status = [t.Literal('ok'), t.Literal('degraded')]

export const app = new Elysia()
	.get(
		'/elysia/:status',
		{ response: t.Object({ status: t.Union(status) }) },
		({ params }) => ({ status: params.status as 'ok' | 'degraded' })
	)
	.get(
		'/typebox/:status',
		{ response: t.Object({ status: Union(status) }) },
		({ params }) => ({ status: params.status as 'ok' | 'degraded' })
	)
