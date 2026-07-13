import { constantTimeEqual } from '../utils'
import { InvalidCookie } from './error'

// eslint-disable-next-line sonarjs/slow-regex -- anchored, single-char class over base64 padding (<=2 chars); linear
const removeTrailingEquals = /=+$/g
const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const
const encoder = new TextEncoder()

interface NodeCrypto {
	createHmac: (
		algorithm: string,
		key: string
	) => {
		update: (data: string) => { digest: (encoding: 'base64') => string }
	}
}

const nodeCrypto = (() => {
	try {
		return (globalThis.process as any)?.getBuiltinModule?.(
			'node:crypto'
		) as NodeCrypto
	} catch {
		return undefined
	}
})()

export const hasSyncHmac = typeof nodeCrypto?.createHmac === 'function'

function coerceValue(val: unknown): string {
	if (typeof val === 'object') return JSON.stringify(val)
	if (typeof val !== 'string') return val + ''

	return val
}

export const signCookieSyncImpl = (val: string, secret: string) =>
	`${val}.${nodeCrypto!
		.createHmac('sha256', secret)
		.update(val)
		.digest('base64')
		.replace(removeTrailingEquals, '')}`

// reuse cookie key
export const keyCache = new Map<string, Promise<CryptoKey>>()

export function importSecretKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret)
	if (key) return key

	if (keyCache.size >= 256) keyCache.clear()

	key = crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		algorithm,
		false,
		['sign']
	)

	key.catch(() => {
		if (keyCache.get(secret) === key) keyCache.delete(secret)
	})

	keyCache.set(secret, key)

	return key
}

export async function signCookieSubtle(val: string, secret: string) {
	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		await importSecretKey(secret),
		encoder.encode(val)
	)

	// Web-native base64: avoid Buffer (unavailable in no-Node environments such
	// as Cloudflare Workers without nodejs_compat).
	const b64 = btoa(String.fromCharCode(...new Uint8Array(hmacBuffer)))

	return `${val}.${b64.replace(removeTrailingEquals, '')}`
}

export async function signCookie(val: string, secret: string | null) {
	val = coerceValue(val)

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	if (hasSyncHmac) return signCookieSyncImpl(val, secret)

	return signCookieSubtle(val, secret)
}

export function signCookieSync(val: string, secret: string | null): string {
	val = coerceValue(val)

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	if (!hasSyncHmac)
		throw new Error('signCookieSync called without a sync HMAC available')

	return signCookieSyncImpl(val, secret)
}

export async function unsignCookie(input: string, secret: string | null) {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	const dot = input.lastIndexOf('.')
	if (dot === -1) {
		if (secret === null) return input

		return false
	}

	const tentativeValue = input.slice(0, dot)

	if (secret === null) return false

	const expectedInput = await signCookie(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}

export function unsignCookieSync(input: string, secret: string | null) {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	const dot = input.lastIndexOf('.')
	if (dot === -1) {
		if (secret === null) return input

		return false
	}

	const tentativeValue = input.slice(0, dot)

	if (secret === null) return false

	const expectedInput = signCookieSync(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}

export const rawJsonValue = new WeakMap<object, string>()

export function maybeJsonDecode(value: unknown) {
	if (typeof value === 'string' && value.length > 1) {
		const starts = value.charCodeAt(0)
		const ends = value.charCodeAt(value.length - 1)

		if ((starts === 123 && ends === 125) || (starts === 91 && ends === 93))
			try {
				const parsed = JSON.parse(value)
				if (parsed !== null && typeof parsed === 'object')
					rawJsonValue.set(parsed, value)

				return parsed
			} catch {}
	}

	return value
}

export function resolvePendingCookie(
	entry: Record<string, any>,
	name: string
) {
	const value = entry.value
	const secrets = entry['~unsign'] as string | (string | null)[]

	if (typeof value !== 'string') throw InvalidCookie.signature(name)
	if (!hasSyncHmac)
		throw new Error(
			`resolvePendingCookie called without sync HMAC — unreachable under correct lane gating (cookie: "${name}")`
		)

	let decoded: string | false = false

	if (typeof secrets === 'string')
		decoded = unsignCookieSync(value, secrets)
	else if (Array.isArray(secrets))
		for (let i = 0; i < secrets.length; i++) {
			const temp = unsignCookieSync(value, secrets[i]!)
			if (temp !== false) {
				decoded = temp
				break
			}
		}

	if (decoded === false)
		throw InvalidCookie.signature(name)

	// Success: update entry in-place, then remove the pending marker.
	const resolvedValue = maybeJsonDecode(decoded)
	entry.value = resolvedValue

	if (resolvedValue !== null && typeof resolvedValue === 'object') {
		const raw = rawJsonValue.get(resolvedValue)
		entry['~raw'] = raw !== undefined ? raw : JSON.stringify(resolvedValue)
	}

	delete entry['~unsign']
}
