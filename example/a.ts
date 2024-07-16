import { Elysia } from '../src'

export const isSignIn = (body: any): boolean | undefined => true
export const findUserById = (id?: string) => id

new Elysia()
    .guard(
        {
            beforeHandle: isSignIn
        },
        (app) =>
            app
                .resolve(({ cookie: { session } }) => ({
                    userId: findUserById(session.value)
                }))
                .get('/profile', ({ userId }) => userId)
    )
    .listen(3000)
