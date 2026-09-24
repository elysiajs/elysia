import { Elysia } from '../../src'

// Signed-cookie verification accepts only the supported eager or lazy modes.
new Elysia({ cookie: { secrets: 'secret', sign: ['sid'], verify: 'eager' } })
// @ts-expect-error "none" is not a signed-cookie verification mode
new Elysia({ cookie: { verify: 'none' } })
