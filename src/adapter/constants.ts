import { isBun } from '../universal/constants'
import { BunAdapter } from './bun'
import { WebStandardAdapter } from './web-standard'

export const getDefaultAdapter = () => (isBun ? BunAdapter : WebStandardAdapter)
