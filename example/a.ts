import { Elysia, t } from '../src'

new Elysia()
	.macro({
		custom: (_: boolean) => ({
			resolve: () => ({
				a: 'a' as const
			})
		})
	})
	.get('/', ({ a }) => '', {
		custom: true
	})
