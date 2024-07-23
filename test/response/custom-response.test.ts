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
})
