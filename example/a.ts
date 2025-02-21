import { Elysia, t } from '../src'

export const IMPORT_SCHEMA = t.Object({
	file: t.File({ error: 'File tidak valid', type: ['text/csv'] })
})

export const IMPORT_DETAIL = {
	summary: 'Import',
	description: 'Impor data pengguna dari file CSV'
}

new Elysia()
	.post(
		'/import',
		({ body }) => {
			const { file } = body
			console.debug('Uploaded file: ', file)
			return {
				message: 'File upload'
			}
		},
		{
			body: IMPORT_SCHEMA,
			detail: IMPORT_DETAIL
		}
	)
	.listen(3000)
