import { Elysia } from '../../src'

// Chained macros can reference earlier macros.
export const a = new Elysia()
	.macro({ auth: (e: boolean) => ({ derive: () => ({ user: 'u' }) }) })
	.macro({ admin: { auth: true, derive: () => ({ role: 'r' }) } })
	.get('/', { admin: true }, ({ user, role }) => ({ user, role }))

// Plugins expose their macros to later macros.
const plug = new Elysia({ name: 'plug' }).macro({
	tenant: (e: boolean) => ({ derive: () => ({ tenant: 't' }) })
})
export const b = new Elysia()
	.use(plug)
	.macro({ scoped: { tenant: true, derive: () => ({ s: 1 }) } })
	.get('/b', { scoped: true }, ({ tenant, s }) => ({ tenant, s }))

export const c = new Elysia().macro({
	// @ts-expect-error Unknown macro property 'bogusKey'
	broken: { bogusKey: true, derive: () => ({ x: 1 }) }
})
