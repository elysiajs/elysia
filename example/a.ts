// import { Elysia, t } from '../src'
// import { post, req } from '../test/utils'

// const app = new Elysia().guard(
//     {
//         query: t.Object({
//             name: t.String()
//         })
//     },
//     (app) =>
//         app
//             // Store is inherited
//             .post('/user', ({ query: { name } }) => name, {
//                 body: t.Object({
//                     id: t.Number(),
//                     username: t.String(),
//                     profile: t.Object({
//                         name: t.String()
//                     })
//                 })
//             })
// )

// console.log(app.routes[0].composed.toString())
// console.log(app.routes[0])

// const invalidBody = await app.handle(
//     new Request('http://localhost/user?name=salt', {
//         method: 'POST',
//         headers: {
//             'content-type': 'application/json',
//         },
//         body: JSON.stringify({
//             id: 6,
//             username: '',
//             profile: {}
//         })
//     })
// )

// console.log(invalidBody.status)