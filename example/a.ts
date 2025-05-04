import Elysia, { t } from '../src'

function addTwo(num: number) {
	return num + 2
}

const app = new Elysia()
	.get('', async ({ query: { foo } }) => addTwo(foo), {
		query: t.Object({
			foo: t
				.Transform(t.String())
				.Decode((x) => 12)
				.Encode((x) => x.toString())
		})
	})
	.listen(1234)
