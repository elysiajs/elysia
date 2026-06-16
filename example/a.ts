import { Type } from 'typebox'
import { Value } from 'typebox/value'

const make = () => Type.Object({ id: Type.Union([Type.Number(), Type.Literal(1)]) })
const A = make()
const B = make()

console.log(JSON.stringify(A) === JSON.stringify(B)) // true

Value.Decode(B, { id: 1 })

console.log(JSON.stringify(A) === JSON.stringify(B)) // false (because of reorder)
