import { Elysia, t } from '../../../src'

// A response schema puts the route on the `set` mapper, yet nothing it runs
// can write `set.cookie`: the jar and serializer are unreachable
export const app = new Elysia()
	.get('/', { response: t.String({ minLength: 1 }) }, () => 'ok')
	.get(
		'/bad',
		{ response: t.Number({ minimum: 0 }) },
		() => 'not a number' as any
	)
