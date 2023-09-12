import { Elysia, t } from '../src'

import { prisma } from '../../../demo/24/src/auth'

const setup = new Elysia()
	.state({
		prisma
	})
	.decorate({
		prisma
	})

const app = new Elysia()
	.decorate({
		a: 'a'
	})
	.state({
		a: 'a'
	})
	.use(setup)
	.decorate({
		b: 'b'
	})
	.state({
		b: 'b'
	})
	.use(setup)
	.get('/', async ({ prisma }) => {
		const a = (await prisma.authKey.findFirst()) ?? 'Empty'

		return a
	})
	.listen(8080)
