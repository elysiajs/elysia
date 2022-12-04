import { Elysia, t } from '../src'

const counter = (app: Elysia) => app.state('nested-counter', 1)

new Elysia()
	.decorate('getDate', () => new Date())
	.state('counter', 1)
	.use(counter)
	.get('/:id', ({ params, getDate, store }) => getDate())
