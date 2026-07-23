import { Elysia } from '../../../src'

const standardBody = {
	'~standard': {
		version: 1,
		vendor: 'aot-test',
		validate: (value: unknown) => ({ value })
	}
}

export default new Elysia().ws('/standard', {
	body: standardBody as any,
	message() {}
})
