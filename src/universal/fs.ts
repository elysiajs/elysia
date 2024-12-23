import type * as Fs from 'fs'
import { env } from './env'

const fs: typeof Fs =
	typeof process !== 'undefined' && env.NODE_ENV
		? require('fs')
		: {}

const noop = () => {}

export const createReadStream: (typeof Fs)['createReadStream'] =
	fs.createReadStream ?? noop
export const statSync: (typeof Fs)['statSync'] = fs.statSync ?? noop

export default fs
