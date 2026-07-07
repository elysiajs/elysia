import { Elysia, t, problem } from '../src'

export const app = new Elysia()
	.macro({
		ip: {
			derive({ request, server }) {
				return { ip: server!.requestIP(request)!.address }
			}
		}
	})
	.macro({
		thing: {
			ip: true,
			beforeHandle({ ip }) {}
		}
	})
