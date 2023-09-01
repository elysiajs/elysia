import { Elysia } from '../src'

export class BasicAuthError extends Error {
	constructor(public message: string) {
		super(message)
	}
}

export interface BasicAuthUser {
	username: string
	password: string
}

export interface BasicAuthConfig {
	users: BasicAuthUser[]
	realm?: string
	errorMessage?: string
	exclude?: string[]
	noErrorThrown?: boolean
}

export const basicAuth = (config: BasicAuthConfig) =>
	new Elysia({ name: 'basic-auth', seed: config })
		.addError({ BASIC_AUTH_ERROR: BasicAuthError })
		.derive((ctx) => {
			console.log("A")

			const authorization = ctx.request.headers.get('Authorization')
			if (!authorization) return { isAuthed: false }
			const [username, password] = atob(
				authorization.split(' ')[1]
			).split(':')
			const isAuthed = config.users.some(
				(user) =>
					user.username === username && user.password === password
			)
			return { isAuthed }
		})
		.onTransform((ctx) => {
			if (!ctx.isAuthed && !config.noErrorThrown) {
				const url = new URL(ctx.request.url)
				if (!config.exclude?.includes(url.pathname))
					throw new BasicAuthError(
						config.errorMessage ?? 'Unauthorized'
					)
			}
		})
		.onError((ctx) => {
			if (ctx.code === 'BASIC_AUTH_ERROR') {
				return new Response(ctx.error.message, {
					status: 401,
					headers: {
						'WWW-Authenticate': `Basic${
							config.realm ? ` realm="${config.realm}"` : ''
						}`
					}
				})
			}
		})

// basicAuth({
// 	users: [{ username: 's', password: 's' }]
// })

const app = new Elysia()
	.use(
		basicAuth({
			users: [
				{
					username: 'S',
					password: 'S'
				}
			]
		})
	)
	.get('/', () => {
		return 'a'
	})
	.listen(8080)
