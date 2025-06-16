import { Elysia, file, form, t } from '../src'

/*
Type 'BunFile[]' is not assignable to type 'File[]'.
Type 'BunFile' is not assignable to type 'File'.
Types of property 'name' are incompatible.
Type 'string | undefined' is not assignable to type 'string'.
*/
new Elysia().get(
	'/test',
	() => {
		return form({
			files: [file('test.png'), file('test.png')],
			text: 'hello'
		})
	},
	{
		response: t.Form({
			files: t.Files(),
			text: t.String()
		})
	}
)
