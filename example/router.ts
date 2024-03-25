import { Elysia } from '../src'

const prefix = <Prefix extends string = string>(prefix: Prefix) =>
	new Elysia({ prefix })
		.state('b', 'b')
		.get('/2', () => 2)
		.guard({}, (app) => app.get('/do', () => 'something'))
		.group('/v2', (app) => app.guard({}, (app) => app.get('/ok', () => 1)))

const a = new Elysia()
	.get('/a', () => 'A')
	.guard({}, (app) => app.get('/guard', () => 'a'))
	.use(prefix('prefixed'))
	.listen(3000)
