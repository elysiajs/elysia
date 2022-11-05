import { KingWorld } from '../src'

new KingWorld()
	// Set global mutable state
	.state('counter', 0)
	.get('/', ({ store }) => store.counter++)
	.listen(3000)
