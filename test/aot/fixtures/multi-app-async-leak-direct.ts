import { Elysia, t } from '../../../src'

// multi-app-async-leak.ts with timer-settled modules, for a direct
// `captureArtifacts(app)`: the sub-app's settles first, while `app` still waits
const later = () =>
	new Promise<Elysia>((resolve) => setTimeout(() => resolve(new Elysia())))

const sub = new Elysia({ precompile: true })
	.use(later())
	.post('/hidden', { body: t.Object({ n: t.Numeric() }) }, ({ body }) => body)
	.post(
		'/b',
		{
			body: t.Object({
				data: t.ObjectString({ admin: t.Boolean() }),
				role: t.String({ error: 'SUB-CUSTOM' })
			})
		},
		({ body }) => body
	)

export const app = new Elysia({ name: 'app' })
	.use(later())
	.post(
		'/b',
		{ body: t.Object({ data: t.String(), role: t.String() }) },
		({ body }) => body
	)
	.mount('/sub', sub.fetch)

// served before its module settles, so it rebuilds while `app` still waits
void sub.handle('/b')
