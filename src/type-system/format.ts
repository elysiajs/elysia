import { FormatRegistry } from '@sinclair/typebox'

/**
 * ? Fork of ajv-formats without ajv as dependencies
 *
 * @see https://github.com/ajv-validator/ajv-formats/blob/master/src/formats.ts
 **/

/* eslint-disable no-control-regex */
export type FormatName =
	| 'date'
	| 'time'
	| 'date-time'
	| 'iso-time'
	| 'iso-date-time'
	| 'duration'
	| 'uri'
	| 'uri-reference'
	| 'uri-template'
	| 'url'
	| 'email'
	| 'hostname'
	| 'ipv4'
	| 'ipv6'
	| 'regex'
	| 'uuid'
	| 'json-pointer'
	| 'json-pointer-uri-fragment'
	| 'relative-json-pointer'
	| 'byte'
	| 'int32'
	| 'int64'
	| 'float'
	| 'double'
	| 'password'
	| 'binary'

export const fullFormats = {
	// date: http://tools.ietf.org/html/rfc3339#section-5.6
	date,
	// date-time: http://tools.ietf.org/html/rfc3339#section-5.6
	time: getTime(true),
	'date-time': getDateTime(true),
	'iso-time': getTime(false),
	'iso-date-time': getDateTime(false),
	// duration: https://tools.ietf.org/html/rfc3339#appendix-A
	duration:
		/^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
	uri,
	'uri-reference':
		/^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
	// uri-template: https://tools.ietf.org/html/rfc6570
	'uri-template':
		/^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
	// For the source: https://gist.github.com/dperini/729294
	// For test cases: https://mathiasbynens.be/demo/url-regex
	url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
	email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
	hostname:
		/^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
	// optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
	ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
	ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
	regex,
	// uuid: http://tools.ietf.org/html/rfc4122
	uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
	// JSON-pointer: https://tools.ietf.org/html/rfc6901
	// uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
	'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
	'json-pointer-uri-fragment':
		/^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
	// relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
	'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
	// the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
	// byte: https://github.com/miguelmota/is-base64
	byte,
	// signed 32 bit integer
	int32: { type: 'number', validate: validateInt32 },
	// signed 64 bit integer
	int64: { type: 'number', validate: validateInt64 },
	// C-type float
	float: { type: 'number', validate: validateNumber },
	// C-type double
	double: { type: 'number', validate: validateNumber },
	// hint to the UI to hide input strings
	password: true,
	// unchecked string payload
	binary: true
} as const

function isLeapYear(year: number): boolean {
	// https://tools.ietf.org/html/rfc3339#appendix-C
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/
const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function date(str: string): boolean {
	// full-date from http://tools.ietf.org/html/rfc3339#section-5.6
	const matches: string[] | null = DATE.exec(str)
	if (!matches) return false
	const year: number = +matches[1]
	const month: number = +matches[2]
	const day: number = +matches[3]
	return (
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month])
	)
}

const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i

function getTime(strictTimeZone?: boolean): (str: string) => boolean {
	return function time(str: string): boolean {
		const matches: string[] | null = TIME.exec(str)
		if (!matches) return false
		const hr: number = +matches[1]
		const min: number = +matches[2]
		const sec: number = +matches[3]
		const tz: string | undefined = matches[4]
		const tzSign: number = matches[5] === '-' ? -1 : 1
		const tzH: number = +(matches[6] || 0)
		const tzM: number = +(matches[7] || 0)
		if (tzH > 23 || tzM > 59 || (strictTimeZone && !tz)) return false
		if (hr <= 23 && min <= 59 && sec < 60) return true
		// leap second
		const utcMin = min - tzM * tzSign
		const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0)
		return (
			(utcHr === 23 || utcHr === -1) &&
			(utcMin === 59 || utcMin === -1) &&
			sec < 61
		)
	}
}

export const parseDateTimeEmptySpace = (str: string) => {
	if (str.charCodeAt(str.length - 6) === 32)
		return str.slice(0, -6) + '+' + str.slice(-5)

	return str
}

const DATE_TIME_SEPARATOR = /t|\s/i
function getDateTime(strictTimeZone?: boolean): (str: string) => boolean {
	const time = getTime(strictTimeZone)

	return function date_time(str: string): boolean {
		// http://tools.ietf.org/html/rfc3339#section-5.6
		const dateTime: string[] = str.split(DATE_TIME_SEPARATOR)

		return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1])
	}
}

const NOT_URI_FRAGMENT = /\/|:/
const URI =
	/^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i

function uri(str: string): boolean {
	// http://jmrware.com/articles/2009/uri_regexp/URI_regex.html + optional protocol + required "."
	return NOT_URI_FRAGMENT.test(str) && URI.test(str)
}

const BYTE =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm

function byte(str: string): boolean {
	BYTE.lastIndex = 0
	return BYTE.test(str)
}

const MIN_INT32 = -(2 ** 31)
const MAX_INT32 = 2 ** 31 - 1

function validateInt32(value: number): boolean {
	return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32
}

function validateInt64(value: number): boolean {
	// JSON and javascript max Int is 2**53, so any int that passes isInteger is valid for Int64
	return Number.isInteger(value)
}

function validateNumber(): boolean {
	return true
}

const Z_ANCHOR = /[^\\]\\Z/
function regex(str: string): boolean {
	if (Z_ANCHOR.test(str)) return false
	try {
		new RegExp(str)
		return true
	} catch (e) {
		return false
	}
}

/**
 * @license
 *
 * MIT License
 *
 * Copyright (c) 2020 Evgeny Poberezkin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const isISO8601 =
	/(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/

const isFormalDate =
	/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT(?:\+|-)\d{4}\s\([^)]+\)/

const isShortenDate =
	/^(?:(?:(?:(?:0?[1-9]|[12][0-9]|3[01])[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:19|20)\d{2})|(?:(?:19|20)\d{2}[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:0?[1-9]|[12][0-9]|3[01]))))(?:\s(?:1[012]|0?[1-9]):[0-5][0-9](?::[0-5][0-9])?(?:\s[AP]M)?)?$/

const _validateDate = fullFormats.date
const _validateDateTime = fullFormats['date-time']

if (!FormatRegistry.Has('date'))
	FormatRegistry.Set('date', (value: string) => {
		// Remove quote from stringified date
		const temp = parseDateTimeEmptySpace(value).replace(/"/g, '')

		if (
			isISO8601.test(temp) ||
			isFormalDate.test(temp) ||
			isShortenDate.test(temp) ||
			_validateDate(temp)
		) {
			const date = new Date(temp)
			if (!Number.isNaN(date.getTime())) return true
		}

		return false
	})

if (!FormatRegistry.Has('date-time'))
	FormatRegistry.Set('date-time', (value: string) => {
		// Remove quote from stringified date
		const temp = value.replace(/"/g, '')

		if (
			isISO8601.test(temp) ||
			isFormalDate.test(temp) ||
			isShortenDate.test(temp) ||
			_validateDateTime(temp)
		) {
			const date = new Date(temp)
			if (!Number.isNaN(date.getTime())) return true
		}

		return false
	})

Object.entries(fullFormats).forEach((formatEntry) => {
	const [formatName, formatValue] = formatEntry

	if (!FormatRegistry.Has(formatName)) {
		if (formatValue instanceof RegExp)
			FormatRegistry.Set(formatName, (value) => formatValue.test(value))
		else if (typeof formatValue === 'function')
			FormatRegistry.Set(formatName, formatValue)
	}
})

if (!FormatRegistry.Has('numeric'))
	FormatRegistry.Set('numeric', (value) => !!value && !isNaN(+value))

if (!FormatRegistry.Has('integer'))
	FormatRegistry.Set(
		'integer',
		(value) => !!value && Number.isInteger(+value)
	)

if (!FormatRegistry.Has('boolean'))
	FormatRegistry.Set(
		'boolean',
		(value) => value === 'true' || value === 'false'
	)

if (!FormatRegistry.Has('ObjectString'))
	FormatRegistry.Set('ObjectString', (value) => {
		let start = value.charCodeAt(0)

		// If starts with ' ', '\t', '\n', then trim first
		if (start === 9 || start === 10 || start === 32)
			start = value.trimStart().charCodeAt(0)

		if (start !== 123 && start !== 91) return false

		try {
			JSON.parse(value)

			return true
		} catch {
			return false
		}
	})

if (!FormatRegistry.Has('ArrayString'))
	FormatRegistry.Set('ArrayString', (value) => {
		let start = value.charCodeAt(0)

		// If starts with ' ', '\t', '\n', then trim first
		if (start === 9 || start === 10 || start === 32)
			start = value.trimStart().charCodeAt(0)

		if (start !== 123 && start !== 91) return false

		try {
			JSON.parse(value)

			return true
		} catch {
			return false
		}
	})
