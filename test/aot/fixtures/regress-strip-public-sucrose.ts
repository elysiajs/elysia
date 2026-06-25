import { Elysia } from '../../../src'
import { bracketPairRange } from '../../../src/sucrose'

// Importing the public/source sucrose module from app code must not be replaced
// by the handler-JIT strip stub. The strip detector only proves route handler
// JIT is unreachable; it says nothing about userland sucrose imports.
export const app = new Elysia().get('/range', () =>
	bracketPairRange('{value}').join(',')
)
