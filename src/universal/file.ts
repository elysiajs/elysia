/* eslint-disable sonarjs/no-duplicate-string */
import { type Stats } from 'fs'
import { createReadStream, statSync } from './fs'

import { isBun } from './utils'
import type { BunFile } from 'bun'

export const mime = {
	aac: 'audio/aac',
	abw: 'application/x-abiword',
	ai: 'application/postscript',
	arc: 'application/octet-stream',
	avi: 'video/x-msvideo',
	azw: 'application/vnd.amazon.ebook',
	bin: 'application/octet-stream',
	bz: 'application/x-bzip',
	bz2: 'application/x-bzip2',
	csh: 'application/x-csh',
	css: 'text/css',
	csv: 'text/csv',
	doc: 'application/msword',
	dll: 'application/octet-stream',
	eot: 'application/vnd.ms-fontobject',
	epub: 'application/epub+zip',
	gif: 'image/gif',
	htm: 'text/html',
	html: 'text/html',
	ico: 'image/x-icon',
	ics: 'text/calendar',
	jar: 'application/java-archive',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	js: 'application/javascript',
	json: 'application/json',
	mid: 'audio/midi',
	midi: 'audio/midi',
	mp2: 'audio/mpeg',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	mpa: 'video/mpeg',
	mpe: 'video/mpeg',
	mpeg: 'video/mpeg',
	mpkg: 'application/vnd.apple.installer+xml',
	odp: 'application/vnd.oasis.opendocument.presentation',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	odt: 'application/vnd.oasis.opendocument.text',
	oga: 'audio/ogg',
	ogv: 'video/ogg',
	ogx: 'application/ogg',
	otf: 'font/otf',
	png: 'image/png',
	pdf: 'application/pdf',
	ppt: 'application/vnd.ms-powerpoint',
	rar: 'application/x-rar-compressed',
	rtf: 'application/rtf',
	sh: 'application/x-sh',
	svg: 'image/svg+xml',
	swf: 'application/x-shockwave-flash',
	tar: 'application/x-tar',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	ts: 'application/typescript',
	ttf: 'font/ttf',
	txt: 'text/plain',
	vsd: 'application/vnd.visio',
	wav: 'audio/x-wav',
	weba: 'audio/webm',
	webm: 'video/webm',
	webp: 'image/webp',
	woff: 'font/woff',
	woff2: 'font/woff2',
	xhtml: 'application/xhtml+xml',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.ms-excel',
	xlsx_OLD:
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xml: 'application/xml',
	xul: 'application/vnd.mozilla.xul+xml',
	zip: 'application/zip',
	'3gp': 'video/3gpp',
	'3gp_DOES_NOT_CONTAIN_VIDEO': 'audio/3gpp',
	'3gp2': 'video/3gpp2',
	'3gp2_DOES_NOT_CONTAIN_VIDEO': 'audio/3gpp2',
	'7z': 'application/x-7z-compressed'
} as const

export const getFileExtension = (path: string) => {
	const index = path.lastIndexOf('.')
	if (index === -1) return ''

	return path.slice(index + 1)
}

export const file = (path: string) => new ElysiaFile(path)

export class ElysiaFile {
	readonly value: unknown
	readonly stats: Stats | undefined

	constructor(public path: string) {
		if (isBun) this.value = Bun.file(path)
		else {
			this.value = createReadStream(path)
			this.stats = statSync(path)!
		}
	}

	get type() {
		return (
			// @ts-ignore
			mime[getFileExtension(this.path)] || 'application/octet-stream'
		)
	}

	get length() {
		if (isBun) return (this.value as BunFile).size

		return this.stats?.size ?? 0
	}
}
