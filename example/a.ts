import { Elysia } from '../src'

const ip = new Elysia({ name: 'ip', seed: 'ip' })
	.derive({ as: 'global' }, ({ server, request }) => {
		return {
			ip: server?.requestIP(request)
		}
	})
	.onBeforeHandle(() => {
		console.log('11')
	})
	.get('/ip', ({ ip }) => ip)

const router1 = new Elysia({ name: 'ip1', seed: 'ip1' })
	.use(ip)
	.get('/ip-1', ({ ip }) => ip)

const router2 = new Elysia({ name: 'ip2', seed: 'ip2' })
	.use(ip)
	.get('/ip-2', ({ ip }) => ip)

const router3 = new Elysia({ name: 'ip2', seed: 'ip2' })
	.use(ip)
	.get('/ip-3', ({ ip }) => ip)

const server = new Elysia({ name: 'server' })
	.use(router1)
	.use(router2)
	.listen(3000)

console.log(server.routes[0])
