import { Elysia, status, t } from '../src'
import { delay, req } from '../test/utils'

const ERRORS = {
	INVALID_API_KEY: status(403, {
		error: {
			type: 'authentication_error',
			code: 'unauthorized',
			doc_url: '',
			message: 'Invalid API key. Authentication failed.'
		}
	}),
	FORBIDDEN: status(401, {
		error: {
			type: 'authentication_error',
			code: 'forbidden',
			doc_url: '',
			message: 'API key is disabled. Access is forbidden.'
		}
	}),
	API_KEY_EXPIRED: status(401, {
		error: {
			type: 'authentication_error',
			code: 'unauthorized',
			doc_url: '',
			message: 'API key has expired. Please provide a valid API key.'
		}
	}),
	UNAUTHORIZED: status(401, {
		error: {
			type: 'authentication_error',
			code: 'unauthorized',
			doc_url: ''
		}
	})
}

const apiKeyAuthMiddleware = new Elysia({ name: 'middleware.auth.apiKey' })
	.guard({
		headers: t.Object({
			'X-API-KEY': t.String()
		})
	})
	.resolve({ as: 'scoped' }, async ({ headers, status }) => {
		const { shortToken } = getTokenComponents(headers['X-API-KEY'])

		if (!shortToken) return ERRORS.INVALID_API_KEY

		const { data: key, error } = await tryCatch(
			db.apiKey.update({
				where: {
					shortToken
				},
				data: {
					requestCount: {
						increment: 1
					}
				},
				include: {
					business: true
				}
			})
		)

		const { data: key, error } = await tryCatch(
			db.apiKey.update({
				where: {
					shortToken
				},
				data: {
					requestCount: {
						increment: 1
					}
				},
				include: {
					business: true
				}
			})
		)

		if (error || !key || !checkAPIKey(headers['X-API-KEY'], key.hash))
			return ERRORS.INVALID_API_KEY

		if (key.enabled === false) return ERRORS.FORBIDDEN

		if (key.expiresAt && Date.now() > key.expiresAt.getTime())
			return ERRORS.API_KEY_EXPIRED

		//TODO check back
		if (!key.business) return ERRORS.UNAUTHORIZED

		return {
			business: key.business
		}
	})

const a = new Elysia()
	// 'business' will be available in the route handlers AFTER use
	// It will only be available in this middleware
	.use(apiKeyAuthMiddleware)
	.get('/', ({ business }) => {

	})
