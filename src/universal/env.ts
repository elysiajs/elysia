import { nullObject } from '../utils'
import { isBun } from './constants'

const nodeEnv =
	typeof process !== 'undefined' && process?.env ? process.env : undefined

export const env = isBun ? Bun.env : (nodeEnv ?? nullObject())
export const hasReadableEnv = isBun || nodeEnv !== undefined
