import { Elysia, t } from '../src'

// ? Local first
const plugin1 = new Elysia()

const main1 = new Elysia()
	.use(plugin1)
	.get('/no-hi', () => '') // Should not log hi
