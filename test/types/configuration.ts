import { Elysia } from '../../src'
import { resumeEmit } from '../../src/experimental/resume'

// Resume emission requires the explicitly imported implementation.
new Elysia({ experimental: { resumeEmit } })
// @ts-expect-error a boolean would make the optional implementation part of every bundle
new Elysia({ experimental: { resumeEmit: true } })

new Elysia({ experimental: { flatFormDataFastPath: true } })
// @ts-expect-error flat FormData fast path is a boolean feature flag
new Elysia({ experimental: { flatFormDataFastPath: 'yes' } })

// Signed-cookie verification accepts only the supported eager or lazy modes.
new Elysia({ cookie: { secrets: 'secret', sign: ['sid'], verify: 'eager' } })
// @ts-expect-error "none" is not a signed-cookie verification mode
new Elysia({ cookie: { verify: 'none' } })
