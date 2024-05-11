import { Elysia, t } from '../src'
import { req } from '../test/utils'

const a = new Elysia().macro(({ onBeforeHandle }) => {
    return {
        a<A extends string>(hi: A) {
            return {
                derive() {
                    return 'a'
                }
            }
        }
    }
})

// app.handle(req('/hello?name=hello+123'))
// 	.then((x) => x.text())
// 	.then((x) => console.log({ x }))
