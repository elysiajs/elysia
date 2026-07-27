import { constantTimeEqual, evictOldestHalf } from '../utils'
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

type BunCryptoHasher = new (
	algorithm: 'sha256',
	key: string
) => {
	update: (data: string) => { digest: (encoding: 'base64') => string }
}

// Materialising `node:crypto` costs ~565 KB / 5.2k objects of native module
// surface at import. Resolve it on demand: under Bun the keyed-hasher probe
// below settles the provider without it, so it is never touched.
let _nodeCrypto: NodeCrypto | undefined
let _nodeCryptoResolved = false

function nodeCrypto() {
	if (!_nodeCryptoResolved) {
		_nodeCryptoResolved = true

		try {
			_nodeCrypto = (globalThis.process as any)?.getBuiltinModule?.(
				'node:crypto'
			) as NodeCrypto
		} catch {}
	}

	return _nodeCrypto
}

// Known-answer test for `Bun.CryptoHasher`: base64 HMAC-SHA256 of 'probe'
// keyed with 'elysia'. This is the exact value `node:crypto` produces for the
// same input, so the probe still asserts byte parity with the node provider
// it just does so against a pinned reference instead of instantiating one
const HMAC_PROBE_DIGEST = 'bzs6y9cVmkYub8fplSKaOuuqMqJlDwhMypFT/jSdCEk='

const bunCryptoHasher = (() => {
	const hasher = (globalThis as any).Bun?.CryptoHasher as
		| BunCryptoHasher
		| undefined

	if (typeof hasher !== 'function') return undefined

	try {
		return new hasher('sha256', 'elysia')
			.update('probe')
			.digest('base64') === HMAC_PROBE_DIGEST
			? hasher
			: undefined
	} catch {
		return undefined
	}
})()

export const hmacProvider: 'bun' | 'node' | 'subtle' = bunCryptoHasher
	? 'bun'
	: typeof nodeCrypto()?.createHmac === 'function'
		? 'node'
		: 'subtle'

export const hasSyncHmac = hmacProvider !== 'subtle'

function coerceValue(val: unknown) {
	if (typeof val === 'object') return JSON.stringify(val)
	if (typeof val !== 'string') return val + ''

	return val
}

export const signCookieBun = (val: string, secret: string) =>
	`${val}.${new bunCryptoHasher!('sha256', secret)
		.update(val)
		.digest('base64')
		.replace(removeTrailingEquals, '')}`

export const signCookieNode = (val: string, secret: string) =>
	`${val}.${nodeCrypto()!
		.createHmac('sha256', secret)
		.update(val)
		.digest('base64')
		.replace(removeTrailingEquals, '')}`

export const signCookieSyncImpl =
	hmacProvider === 'bun' ? signCookieBun : signCookieNode

// reuse cookie key
export const keyCache = new Map<string, Promise<CryptoKey>>()

export function importSecretKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret)
	if (key) {
		if (keyCache.size >= 256) {
			keyCache.delete(secret)
			keyCache.set(secret, key)
		}

		return key
	}

	if (keyCache.size >= 256) evictOldestHalf(keyCache)

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

export function signCookieSync(val: string, secret: string | null) {
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

export function unsignWithSecretsSync(
	name: string,
	value: unknown,
	secrets: string | null | (string | null)[] | undefined
) {
	if (typeof value !== 'string') throw InvalidCookie.signature(name)

	if (typeof secrets === 'string') {
		const temp = unsignCookieSync(value, secrets)
		if (temp === false) throw InvalidCookie.signature(name)

		return temp
	}

	if (Array.isArray(secrets))
		for (let i = 0; i < secrets.length; i++) {
			const temp = unsignCookieSync(value, secrets[i]!)
			if (temp !== false) return temp
		}

	throw InvalidCookie.signature(name)
}

export async function unsignWithSecrets(
	name: string,
	value: unknown,
	secrets: string | null | (string | null)[] | undefined
) {
	if (typeof value !== 'string') throw InvalidCookie.signature(name)

	if (typeof secrets === 'string') {
		const temp = await unsignCookie(value, secrets)
		if (temp === false) throw InvalidCookie.signature(name)

		return temp
	}

	if (Array.isArray(secrets))
		for (let i = 0; i < secrets.length; i++) {
			const temp = await unsignCookie(value, secrets[i]!)
			if (temp !== false) return temp
		}

	throw InvalidCookie.signature(name)
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

export function resolvePendingCookie(entry: Record<string, any>, name: string) {
	const value = entry.value

	if (typeof value !== 'string') throw InvalidCookie.signature(name)
	if (!hasSyncHmac)
		throw new Error(
			`resolvePendingCookie called without sync HMAC. Unreachable under correct lane gating (cookie: "${name}")`
		)

	const decoded = unsignWithSecretsSync(
		name,
		value,
		entry['~unsign'] as string | (string | null)[]
	)

	// Success: update entry in-place, then remove the pending marker.
	const resolvedValue = maybeJsonDecode(decoded)
	entry.value = resolvedValue

	if (resolvedValue !== null && typeof resolvedValue === 'object') {
		const raw = rawJsonValue.get(resolvedValue)
		entry['~raw'] = raw !== undefined ? raw : JSON.stringify(resolvedValue)
	}

	delete entry['~unsign']
}
