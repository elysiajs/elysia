import { createContext, Elysia, t } from 'elysia'
import { Compiled } from '../../../dist/compile/aot.mjs'

export const app = new Elysia()
	.get('/u', { query: t.Object({ first: t.String() }) }, ({ query }) => query)
	.get(
		'/u',
		{ query: t.Object({ second: t.Number() }) },
		({ query }) => query
	)

const Context = createContext(app as any)
const capturedLoser = app.handler(0)

const invoke = (
	handler: ReturnType<typeof app.handler>,
	query: string = 'first=loser'
) => handler(new Context(new Request(`http://localhost/u?${query}`)))

export const invokeCapturedLoser = (query?: string) =>
	invoke(capturedLoser, query)
export const invokeFreshLoser = (query?: string) =>
	invoke(app.handler(0), query)
export const programAlive = () =>
	Compiled.hasProgram((app as any)['~programId'])
