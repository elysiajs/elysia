import { Context } from '../context'
import { ElysiaAdapterOptions } from './types'

export function createAdapter(adapter: ElysiaAdapterOptions) {
	return {
		...adapter,
		parse: {
			...adapter.parse,
			default: (
				(
					json: ElysiaAdapterOptions['parse']['json'],
					urlencoded: ElysiaAdapterOptions['parse']['urlencoded'],
					arrayBuffer: ElysiaAdapterOptions['parse']['arrayBuffer'],
					formData: ElysiaAdapterOptions['parse']['formData'],
					text: ElysiaAdapterOptions['parse']['text']
				) =>
				(context: Context, contentType: string) => {
					switch (contentType.charCodeAt(12)) {
						case 106:
							return json(context)

						case 120:
							return urlencoded(context)

						case 111:
							return arrayBuffer(context)

						case 114:
							return formData(context)

						default:
							if (contentType.charCodeAt(0) === 116)
								return text(context)
					}
				}
			)(
				adapter.parse.json,
				adapter.parse.urlencoded,
				adapter.parse.arrayBuffer,
				adapter.parse.formData,
				adapter.parse.text
			)
		}
	}
}

export type ElysiaAdapter = ReturnType<typeof createAdapter>

export type { ElysiaAdapterOptions } from './types'
