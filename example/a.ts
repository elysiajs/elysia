import { t, getSchemaValidator } from '../src'
import { sucrose } from '../src/sucrose'

const v = sucrose({
	handler: (context) => {
		console.log('path >>> ', context.path)
		console.log(context)

		return { id: 'test' }
	}
})

console.log(v)
