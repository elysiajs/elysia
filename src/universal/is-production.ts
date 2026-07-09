import { env } from './env'

export const isProduction = () => (env.NODE_ENV ?? env.ENV) === 'production'
