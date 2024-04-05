import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Non 200 Response Type', () => {
    it('returns 204', async () => {
        const app = new Elysia()
            .get('/', ({ set }) => {
                set.status = 204
            }, {
                response: {
                    204: t.Void()
                }
            })
            .listen(3000)

        const response = await app.handle(req('/'))

        expect(response.status).toBe(204)
    })
})