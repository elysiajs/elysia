import { Elysia, t } from '../src'

const counter = (app: Elysia) => app.setStore('nested-counter', 1)

new Elysia()
	.decorate('getDate', () => new Date())
	.setStore('counter', 1)
	.use(counter)
	.get('/:id', ({ params, getDate, store }) => getDate())
