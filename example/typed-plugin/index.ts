import KingWorld from '../../src'
import plugin from './plugin'

export let app = new KingWorld().state('counter', 1)

app = app
	.use(plugin)
	.get('/', ({ store }) => store.counter++)
	.listen(3000)
