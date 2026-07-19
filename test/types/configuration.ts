import { Elysia } from '../../src'
import { resumeEmit } from '../../src/experimental/resume'
import { validationPlan } from '../../src/experimental/validation-plan'

// Resume emission requires the explicitly imported implementation.
new Elysia({ experimental: { resumeEmit } })
// @ts-expect-error a boolean would make the optional implementation part of every bundle
new Elysia({ experimental: { resumeEmit: true } })

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
