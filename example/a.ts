import { Elysia } from '../src'

new Elysia()
	.macro({
		ip: {
			derive: ({ server, request }) => ({
				ip: server?.requestIP(request)
			})
		}
	})
	.macro({
		ip2: {
			ip: true,
			derive: ({ ip }) => ({
				address: ip?.address
			})
		}
	})
	.get('/', { ip2: true }, ({ address }) => address)
