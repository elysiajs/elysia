import { Elysia } from '../src'

new Elysia()
	.decorate('echo', (word: string) => word)
	.get('/', ({ echo }) => echo('hi'))
