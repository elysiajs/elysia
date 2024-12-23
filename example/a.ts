import { Elysia, t } from '../src'

export const auth = new Elysia().macro({
	isAuth(isAuth: boolean) {
		return {
			resolve() {
				return {
					user: 'saltyaom'
				}
			}
		}
	},
	role(role: 'admin' | 'user') {
		return {}
	}
})

new Elysia().ws('/ws', {
	ping: (message) => message
})
