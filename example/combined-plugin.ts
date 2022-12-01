import { KingWorld, t } from '../src'

const counter = (app: KingWorld) => app.state('nested-counter', 1)

new KingWorld()
	.decorate('getDate', () => new Date())
	.state('counter', 1)
	.use(counter)
	.get('/:id', ({ params, getDate, store }) => getDate())
