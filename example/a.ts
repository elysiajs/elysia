import { Elysia, t } from '../src'

const app = new Elysia()
	.macro({
		custom: (stuff: boolean) => ({
			resolve: () => ({
				a: 'a'
			})
		})
	})
	.get('/', ({ a, query }) => { }, {
		query: t.Object({ a: t.String() }),
		custom: true
	})
