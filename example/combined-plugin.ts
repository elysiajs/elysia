import { KingWorld, t } from '../src'

const counter = (app: KingWorld) => app.state('nested-counter', 1)

new KingWorld()
	.state('counter', 1)
	.use(counter)
	.get('/:id', ({ store, params }) => store, {
		beforeHandle: ({ query, params }) => {},
		schema: {
			body: t.Object({
				name: t.String()
			}),
			params: t.Object({
				id: t.Number(),
				A: t.Number()
			})
		}
	})
