import { Elysia } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'

// @ts-expect-error precompile is no longer a public configuration option
new Elysia({ precompile: true })
// @ts-expect-error precompile: false first-request compilation was removed
new Elysia({ precompile: false })

new Elysia({ experimental: { cancellation: 'suspension' } })
// @ts-expect-error compat cancellation polling was removed
new Elysia({ experimental: { cancellation: 'compat' } })
// @ts-expect-error cancellation accepts only the suspension policy
new Elysia({ experimental: { cancellation: 'poll' } })

new Elysia({ experimental: { validationPlan } })
// @ts-expect-error the implementation must be explicitly imported
new Elysia({ experimental: { validationPlan: true } })
// @ts-expect-error the alternate flat FormData production path was removed
new Elysia({ experimental: { flatFormDataFastPath: true } })

// Signed-cookie verification accepts only the supported eager or lazy modes.
new Elysia({ cookie: { secrets: 'secret', sign: ['sid'], verify: 'eager' } })
// @ts-expect-error "none" is not a signed-cookie verification mode
new Elysia({ cookie: { verify: 'none' } })
