import { Elysia, t } from '../src'

const one = new Elysia({ name: 'one' }).onRequest(() => console.log('Hello, one!'))
const two = new Elysia().use(one)

const three = new Elysia()
	.use(one)
	.use(two)
	.get('/hello', () => 'Hello, world!')
	.listen(3000)

// three.handle(new Request('http://localhost:3000/hello'))
