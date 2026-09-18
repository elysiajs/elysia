import { Elysia } from '../../../src'
import { bracketPairRange } from '../../../src/sucrose'

// User imports of sucrose remain live when route compilation no longer needs it.
export const app = new Elysia().get('/range', () =>
	bracketPairRange('{value}').join(',')
)
