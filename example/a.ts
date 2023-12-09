import { Elysia, t } from '../dist'
import { post, req } from '../test/utils'

const app = new Elysia().guard(
    {
        query: t.Object({
            name: t.String()
        })
    },
    (app) =>
        app
            // Store is inherited
            .post('/user', ({ query: { name } }) => name, {
                body: t.Object({
                    id: t.Number(),
                    username: t.String(),
                    profile: t.Object({
                        name: t.String()
                    })
                })
            })
)

const body = JSON.stringify({
    id: 6,
    username: '',
    profile: {
        name: 'A'
    }
})

const valid = await app.handle(
    new Request('http://localhost/user?name=salt', {
        method: 'POST',
        body,
        headers: {
            'content-type': 'application/json',
            'content-length': body.length.toString()
        }
    })
)

// expect(await valid.text()).toBe('salt')
// expect(valid.status).toBe(200)

const invalidQuery = await app.handle(
    new Request('http://localhost/user', {
        method: 'POST',
        body: JSON.stringify({
            id: 6,
            username: '',
            profile: {
                name: 'A'
            }
        })
    })
)

console.log(invalidQuery.status, 400)

const invalidBody = await app.handle(
    new Request('http://localhost/user?name=salt', {
        method: 'POST',
        body: JSON.stringify({
            id: 6,
            username: '',
            profile: {}
        })
    })
)

console.log(invalidBody.status, 400)