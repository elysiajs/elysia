import { mapCompactResponse, mapResponse } from './handler'
import { parse } from './parse'

import { createAdapter } from '..'

export const WebStandardAdapter = createAdapter({
	parse,
	response: {
		map: mapResponse,
		supportsDefaultHeaderSink: true,
		compact: mapCompactResponse
	}
})
