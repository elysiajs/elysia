import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'


class CustomResponse extends Response { }

describe('Custom Response Type', () => {
    it('returns custom response when set headers is not empty', async () => {
        const app = new Elysia()
            .get('/', ({ set }) => {
                set.headers['X-POWERED-BY'] = 'Elysia'
                return new CustomResponse('Shuba Shuba', {
                    headers: {
                        duck: 'shuba duck'
                    },
                    status: 418
                })
            })

        const response = await app.handle(req('/'))

        expect(await response.text()).toBe('Shuba Shuba')
        expect(response.headers.get('duck')).toBe('shuba duck')
        expect(response.headers.get('X-POWERED-BY')).toBe('Elysia')
        expect(response.status).toBe(418)
    })

    it('returns custom response when set headers is empty', async () => {
        const app = new Elysia()
            .get('/', () => {
                return new CustomResponse('Shuba Shuba')
            })

        const response = await app.handle(req('/'))

        expect(await response.text()).toBe('Shuba Shuba')
    })

    it('Response headers take precedence, set.headers merge non-conflicting', async () => {
        const app = new Elysia()
            .onRequest(({ set }) => {
                set.headers['Content-Type'] = 'application/json'
                set.headers['X-Framework'] = 'Elysia'
            })
            .get('/', () => {
                return new Response('{"message":"hello"}', {
                    headers: {
                        'Content-Type': 'text/plain',
                        'X-Custom': 'custom-value'
                    }
                })
            })

        const response = await app.handle(req('/'))

        // Response's Content-Type takes precedence
        expect(response.headers.get('Content-Type')).toBe('text/plain')
        // set.headers adds non-conflicting headers
        expect(response.headers.get('X-Framework')).toBe('Elysia')
        // Response's own headers are preserved
        expect(response.headers.get('X-Custom')).toBe('custom-value')
    })
})
