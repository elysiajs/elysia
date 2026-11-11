import { nullObject } from '../utils'

const nodeEnv =
	typeof process !== 'undefined' && process?.env ? process.env : undefined

export const env = nodeEnv ?? nullObject()
export const hasReadableEnv = nodeEnv !== undefined
