import KingWorld from '../src'
import { z } from 'zod'

const counter = (app: KingWorld) => app.state('counter', 0)

new KingWorld()
	.use(counter)
	.guard({}, (app) => app.get('/id/:id', ({ store: { counter } }) => counter))
	.listen(3000)
