import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'

describe('Bun adapter', () => {
    it('handle query guard', async () => {
        const app = new Elysia()
            .guard(({
                query: t.Object({ a: t.String() }),
            }))
            .get("/works-with", ({ query }) => "Works" + query.a)
            .get("/works-without", () => "Works without")
            .listen(0)

        const query = await fetch(
                `http://localhost:${app.server!.port}/works-with?a=with`
        ).then((x) => x.text())

        expect(query).toEqual("Workswith")

        const query2 = await fetch(
            `http://localhost:${app.server!.port}/works-without?a=1`
        ).then((x) => x.text())

        expect(query2).toEqual("Works without")
    })

    it('handle standalone query guard', async () => {
        const app = new Elysia()
            .guard(({
                query: t.Object({ a: t.String() }),
                schema: "standalone"
            }))
            .get("/works-with", ({ query }) => "Works" + query.a)
            .get("/works-without", () => "Works without")
            .listen(0)

        const query = await fetch(
                `http://localhost:${app.server!.port}/works-with?a=with`
        ).then((x) => x.text())

        expect(query).toEqual("Workswith")

        const query2 = await fetch(
            `http://localhost:${app.server!.port}/works-without?a=1`
        ).then((x) => x.text())

        expect(query2).toEqual("Works without")
    })
})
