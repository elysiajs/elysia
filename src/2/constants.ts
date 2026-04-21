const mapBack = <const T extends Record<string, number>>(
	map: T
): {
	[K in keyof T as T[K]]: K
} =>
	Object.fromEntries(
		Object.entries(map).map(([key, value]) => [value, key])
	) as any

export const MethodMap = {
	GET: 0,
	HEAD: 1,
	POST: 2,
	PUT: 3,
	DELETE: 4,
	PATCH: 5,
	OPTIONS: 6,
	CONNECT: 7,
	TRACE: 8
} as const
export type MethodMap = typeof MethodMap

export const MethodMapBack = mapBack(MethodMap)
export type MethodMapBack = typeof MethodMapBack

export const StatusMap = {
	Continue: 100,
	'Switching Protocols': 101,
	Processing: 102,
	'Early Hints': 103,
	OK: 200,
	Created: 201,
	Accepted: 202,
	'Non-Authoritative Information': 203,
	'No Content': 204,
	'Reset Content': 205,
	'Partial Content': 206,
	'Multi-Status': 207,
	'Already Reported': 208,
	'Multiple Choices': 300,
	'Moved Permanently': 301,
	Found: 302,
	'See Other': 303,
	'Not Modified': 304,
	'Temporary Redirect': 307,
	'Permanent Redirect': 308,
	'Bad Request': 400,
	Unauthorized: 401,
	'Payment Required': 402,
	Forbidden: 403,
	'Not Found': 404,
	'Method Not Allowed': 405,
	'Not Acceptable': 406,
	'Proxy Authentication Required': 407,
	'Request Timeout': 408,
	Conflict: 409,
	Gone: 410,
	'Length Required': 411,
	'Precondition Failed': 412,
	'Payload Too Large': 413,
	'URI Too Long': 414,
	'Unsupported Media Type': 415,
	'Range Not Satisfiable': 416,
	'Expectation Failed': 417,
	"I'm a teapot": 418,
	'Enhance Your Calm': 420,
	'Misdirected Request': 421,
	'Unprocessable Content': 422,
	Locked: 423,
	'Failed Dependency': 424,
	'Too Early': 425,
	'Upgrade Required': 426,
	'Precondition Required': 428,
	'Too Many Requests': 429,
	'Request Header Fields Too Large': 431,
	'Unavailable For Legal Reasons': 451,
	'Internal Server Error': 500,
	'Not Implemented': 501,
	'Bad Gateway': 502,
	'Service Unavailable': 503,
	'Gateway Timeout': 504,
	'HTTP Version Not Supported': 505,
	'Variant Also Negotiates': 506,
	'Insufficient Storage': 507,
	'Loop Detected': 508,
	'Not Extended': 510,
	'Network Authentication Required': 511
} as const
export type StatusMap = typeof StatusMap

export const EventMap = {
	request: 0,
	parse: 1,
	transform: 2,
	beforeHandle: 3,
	afterHandle: 4,
	mapResponse: 5,
	afterResponse: 6,
	error: 7,
	trace: 8,
	start: 9,
	stop: 10
} as const
export type EventMap = typeof EventMap

export const EventMapBack = mapBack(EventMap)
export type EventMapBack = typeof EventMapBack
