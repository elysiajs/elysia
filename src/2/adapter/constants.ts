import { isBun } from '../universal/utils'
import { BunAdapter } from './bun'
import { WebStandardAdapter } from './web-standard'

export const getDefaultAdapter = () => (isBun ? BunAdapter : WebStandardAdapter)
