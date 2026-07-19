import { Elysia } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'

new Elysia({ experimental: { cancellation: 'suspension' } })
new Elysia({ experimental: { cancellation: 'compat' } })
// @ts-expect-error cancellation accepts only the two Q12 policies
new Elysia({ experimental: { cancellation: 'poll' } })

new Elysia({ experimental: { flatFormDataFastPath: true } })
// @ts-expect-error flat FormData fast path is a boolean feature flag
new Elysia({ experimental: { flatFormDataFastPath: 'yes' } })

new Elysia({ experimental: { validationPlan } })
// @ts-expect-error the implementation must be explicitly imported
new Elysia({ experimental: { validationPlan: true } })

// Signed-cookie verification accepts only the supported eager or lazy modes.
new Elysia({ cookie: { secrets: 'secret', sign: ['sid'], verify: 'eager' } })
// @ts-expect-error "none" is not a signed-cookie verification mode
new Elysia({ cookie: { verify: 'none' } })
