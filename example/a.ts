import { Elysia, t } from '../src'
import { hasRef, hasTransform } from '../src/compose'
import { TypeCompiler } from '../src/type-system'
import { req } from '../test/utils'

// use a simple string-number transform to demo
const encodedNumberSchema = t
	.Transform(t.String())
	.Decode((value) => parseFloat(value))
	.Encode((value) => value.toString())

// put the transform type in object for easily checking.
const dataTransferObject = t.Object({
	value: encodedNumberSchema
})

const a = TypeCompiler.Compile(encodedNumberSchema)

const elysia = new Elysia({
	experimental: {
		encodeSchema: true //open the flag!
	}
}).post(
	'/',
	({ body }) => {
		// body.value is number!
		console.log(typeof body.value) // number here! like my expectation
		return body
	},
	{
		body: dataTransferObject, //in swagger, request body.value should be a string
		response: dataTransferObject //in swagger, reponse body.value should be a string
	}
)

await elysia
	.handle(
		new Request('http://localhost:3000/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ value: '1.1' })
		})
	)
	.then((res) => res.json())
	.then(console.log) //still error here, it says:

/*
{
  type: "validation",
  on: "response",
  summary: "Expected  property 'value' to be  string but found: 1.1",
  property: "/value",
  message: "Expected string",
  expected: {
    value: "",
  },
  found: {
    value: 1.1,
  },
  errors: [
    {
      type: 54,
      schema: [Object ...],
      path: "/value",
      value: 1.1,
      message: "Expected string",
      errors: [],
      summary: "Expected  property 'value' to be  string but found: 1.1",
    }
  ],
}
*/
