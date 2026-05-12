import { isBun } from './constants'

export const env = isBun
	? Bun.env
	: typeof process !== 'undefined' && process?.env
		? process.env
		: {}
