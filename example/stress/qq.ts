// suppose this is Elysia 1.0
import { Elysia, t } from 'elysia1'
// suppose this is Elysia 2.0
import { Elysia as Elysian, t as t2 } from 'elysia2'

const elysia1 = new Elysia()
	.get('/', () => 'Hi')
	.get('/query', (c) => c.query.name)
	.post('/sign-in', (c) => c.body, {
		parse: 'json'
	})
	.derive(() => {
		return {
			hello: 'world'
		}
	})
	.get('/derive', ({ hello }) => {
		return hello
	})

const elysia2 = new Elysian()
	.get('/', () => 'Hi')
	.get('/query', (c) => c.query.name)
	.post('/sign-in', { parse: 'json' }, (c) => c.body)
	.derive(() => {
		return {
			hello: 'world'
		}
	})
	.get('/derive', ({ hello }) => {
		return hello
	})

const index = new Request('http://localhost/')
const query = new Request('http://localhost/query?name=saltyaom&id=1')
const signIn = new Request('http://localhost/sign-in', {
	method: 'POST',
	body: JSON.stringify({
		username: 'saltyaom',
		password: '12345678'
	}),
	headers: {
		'Content-Type': 'application/json'
	}
})
const derive = new Request('http://localhost/derive')

elysia1.compile()
elysia2.fetch

for (const r of elysia1.routes) r.compile()
for (let i = 0; i < elysia2.routes.length; i++) elysia2.handler(i, true)

const elysiaFetch = elysia1.fetch
const elysianFetch = elysia2.fetch

mitata(() => {
	add('Elysia 1.4 Index', () => elysiaFetch(index.clone()))
	add('Elysia 2 Index', () => elysianFetch(index.clone()))
	add('Elysia 1.4 Query', () => elysiaFetch(query.clone()))
	add('Elysia 2 Query', () => elysianFetch(query.clone()))
	add('Elysia 1.4 Body', () => elysiaFetch(signIn.clone()))
	add('Elysia 2 Body', () => elysianFetch(signIn.clone()))
	add('Elysia 1.4 Derive', () => elysiaFetch(derive.clone()))
	add('Elysia 2 Derive', () => elysianFetch(derive.clone()))
})
