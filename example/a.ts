import { Elysia } from '../src'

async function mountedHandler(request: Request): Promise<Response> {
	return Response.json(await request.json())
}

const serverAotFalse = new Elysia({ aot: false })
	.mount('/api', async (request) => Response.json(await request.json()))
	.listen(3002)
