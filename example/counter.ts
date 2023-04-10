import { Elysia } from '../src'

new Elysia()
	.setStore('counter', 0)
	.get('/', ({ store }) => store.counter++)
	.listen(8080)
