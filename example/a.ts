import { Context, Elysia, t } from '../src'
import { post, req } from '../test/utils'

const checker = {
	check: async (ctx: Context, name: string, state?: string) => {
		return typeof state !== 'undefined'
	}
}

const app = new Elysia()
	.derive((ctx) => {
		const { name } = ctx.params

		return {
			check: async () => {
				const { state } = ctx.query

				if (
					!(await checker.check(ctx, name, state ?? ctx.query.state))
				) {
					throw new Error('State mismatch')
				}
			}
		}
	})
	.get('/:name', async (ctx) => {
		await ctx.check()
		return 'yay'
	})

app.handle(req('/a'))
	.then((x) => x.text())
	.then(console.log)
