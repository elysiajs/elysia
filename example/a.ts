import { Elysia, t } from '../src'

const app = new Elysia()
	.macro({
		satre: {
			query: t.Object({ sartre: t.Literal('Sartre') })
		}
	})
	.post('/:satre', ({ query, QQ }) => query.sartre, {
		satre: true
	})
