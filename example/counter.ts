import { KingWorld } from '../src'

new KingWorld()
	.state('counter', 0)
	.get('/', ({ store }) => store.counter++)
	.listen(8080)
