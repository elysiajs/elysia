import { env, hasReadableEnv } from './env'

export const isProduction = () =>
	!hasReadableEnv || (env.NODE_ENV ?? env.ENV) === 'production'
