import { Type, Static, StaticDecode, StaticEncode } from '@sinclair/typebox'

const T = Type.Array(Type.Number(), { uniqueItems: true })

// const T = Type.Transform(Type.Array(Type.Number(), { uniqueItems: true }))         
//   .Decode(value => new Set(value))
//   .Encode(value => [...value])

type D = StaticDecode<typeof T>   