import { env, hasReadableEnv } from './env'

export const computeIsProduction = (
	readable: boolean,
	nodeEnv?: string,
	elysiaEnv?: string
) => !readable || (nodeEnv ?? elysiaEnv) === 'production'

export const isProduction = () =>
	computeIsProduction(hasReadableEnv, env.NODE_ENV, env.ENV)
