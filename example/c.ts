import type { Elysia } from "../src";

export default function plugin(app: Elysia) {
    return app.get('/from-plugin', () => 'hi')
}