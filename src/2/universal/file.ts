/* eslint-disable sonarjs/no-duplicate-string */
import { type createReadStream as CreateReadStream } from 'fs'
import { type stat as Stat } from 'fs/promises'
import type { BunFile } from 'bun'

import { isBun } from './utils'

export const mime = {
	// web
	html: 'text/html',
	htm: 'text/html',
	css: 'text/css',
	js: 'application/javascript',
	ts: 'application/typescript',
	json: 'application/json',
	xml: 'application/xml',

	// images
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	ico: 'image/x-icon',

	// video
	mp4: 'video/mp4',
	webm: 'video/webm',

	// audio
	mp3: 'audio/mpeg',
	wav: 'audio/x-wav',

	// fonts
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',

	// docs
	pdf: 'application/pdf',
	txt: 'text/plain',
	csv: 'text/csv',

	// archive
	zip: 'application/zip',

	// office
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
} as const

export const getFileExtension = (path: string) => {
	const index = path.lastIndexOf('.')
	if (index === -1) return ''

	return path.slice(index + 1)
}

export const file = (path: string) => new ElysiaFile(path)

let createReadStream: typeof CreateReadStream
let stat: typeof Stat

const warnMissing = (name?: string) =>
	console.warn(
		new Error(
			`[elysia] \`file\` require \`fs${name ? '.' + name : ''}\` ${name?.includes('.') ? 'module ' : ''}which is not available in this environment`
		)
	)

export class ElysiaFile {
	readonly value: unknown
	readonly stats: ReturnType<typeof Stat> | undefined

	constructor(public path: string) {
		if (isBun) this.value = Bun.file(path)
		else {
			// Browser
			// @ts-ignore
			if (!createReadStream || !stat) {
				// @ts-ignore
				if (typeof window !== 'undefined') {
					console.warn('Browser environment does not support file')
					return
				}

				if (
					typeof process === 'undefined' ||
					typeof process.getBuiltinModule !== 'function'
				) {
					warnMissing()
					return
				}

				const fs = process.getBuiltinModule('fs')
				if (
					!fs ||
					typeof fs.createReadStream !== 'function' ||
					typeof fs.promises?.stat !== 'function'
				) {
					warnMissing()
					return
				}

				createReadStream = fs.createReadStream
				stat = fs.promises.stat
			}

			// Readstream can be only readonce
			// IIFE to ensure it's created immediately
			this.value = (() => createReadStream(path))()
			this.stats = stat(path)!
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

		return this.stats?.then((x) => x.size) ?? 0
	}
}
