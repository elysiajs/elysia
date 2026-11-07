import { Elysia } from '../../../src'

// A named plugin installed by a child first, then by the root itself: the
// root's routes get its plugin-scope derive and gate, in the plugin's order
export const calls: string[] = []

const auth = new Elysia({ name: 'strip-dedup-auth' })
	.derive('plugin', ({ headers }) => ({ user: headers.authorization }))
	.onBeforeHandle('global', ({ user }: any) => {
		calls.push(`global:${user}`)
	})
	.onBeforeHandle('plugin', ({ user, status }: any) => {
		calls.push('gate')
		if (!user) return status(401, 'no')
	})

export const app = new Elysia()
	.use(new Elysia().use(auth).get('/feature', () => 'feature'))
	.use(auth)
	.get('/admin', ({ user }: any) => `user=${user}`)
