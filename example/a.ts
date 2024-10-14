import { Elysia } from '../src'

const app = new Elysia()
	.post('/', async ({ request }) => console.log(await request.arrayBuffer()))
	.listen(3000)
