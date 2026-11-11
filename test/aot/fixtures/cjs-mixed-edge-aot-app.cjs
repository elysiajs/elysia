const { Elysia } = require('elysia')

// Keep the opposite edge reachable in the bundle graph without evaluating it
// during AOT capture.
const loadElysiaWithImport = () => import('elysia')

module.exports = {
	app: new Elysia().get('/', () => typeof loadElysiaWithImport)
}
