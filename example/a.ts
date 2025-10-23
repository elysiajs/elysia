import { Elysia, file } from '../src'

const app = new Elysia({
	allowUnsafeValidationDetails: true
})
	.get('/', file('test/images/aris-yuzu.jpg'))
	.listen(3000)
