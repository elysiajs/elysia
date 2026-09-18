import { isBun } from '../universal/constants'
import { BunAdapter } from './bun'
import { WebStandardAdapter } from './web-standard'

export const defaultAdapter = isBun ? BunAdapter : WebStandardAdapter
