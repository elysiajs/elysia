import { Elysia, t, form, file, error } from '../src'

const app = new Elysia().use([
	new Elysia().get('/a', 'a').decorate('A', 'A'),
	new Elysia().get('/b', 'b').decorate('B', 'B')
])
