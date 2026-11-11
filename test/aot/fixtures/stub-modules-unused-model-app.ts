import { Elysia, t } from '../../../src'

// Evaluated with the bundle but never used: its model is still snapshotted
new Elysia().model({ name: t.String() })

export const app = new Elysia().get('/', 'ok')
