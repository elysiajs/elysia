import { parseQuery } from '../../parse-query'
import { ElysiaAdapter } from '../types'
import {
	mapCompactResponse,
	mapEarlyResponse,
	mapResponse,
	mapStaticHandler
} from './handler'

export const webStandardAdapter = {
	name: 'web-standard',
	runtime: 'unknown',
	isWebStandard: true,
	listen: () => () => {
		throw new Error('Not supported')
	},
	parse: {
		arrayBuffer: (context) => context.request.arrayBuffer(),
		formData: (context) => context.request.formData(),
		json: (context) => context.request.json(),
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery)
	},
	response: {
		map: mapResponse,
		early: mapEarlyResponse,
		compact: mapCompactResponse,
		static: mapStaticHandler
	}
} satisfies ElysiaAdapter
