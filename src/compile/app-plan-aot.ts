import {
	AOT_MANIFEST_FORMAT,
	Compiled,
	type FrozenValidator,
	type FrozenWSRoute,
	type ValidatorSlot
} from './aot'
import {
	assertAppPlanPublicationIdentity,
	programIdentitiesEqual,
	validatorSlotDescriptorsEqual,
	type AppPlan,
	type AppPlanFingerprint,
	type ExternalBindingDescriptor,
	type ProgramIdentity,
	type ValidatorSlotDescriptor
} from './app-plan'

export interface AppPlanAotPayload {
	readonly format: typeof AOT_MANIFEST_FORMAT
	readonly fingerprint: AppPlanFingerprint
}

export interface AppPlanAotValidatorImage {
	readonly identity: ValidatorSlotDescriptor
	readonly image: FrozenValidator
}

export interface AppPlanAotValidatorManifest {
	[method: string]: {
		[path: string]: Partial<
			Record<ValidatorSlot, AppPlanAotValidatorImage>
		>
	}
}

export interface AppPlanAotWSImage {
	readonly identity: ProgramIdentity
	readonly roles: readonly string[]
	readonly image: FrozenWSRoute
}

export interface AppPlanAotWSManifest {
	[path: string]: AppPlanAotWSImage
}

export interface BoundAppPlanAotImage {
	readonly fingerprint: AppPlanFingerprint
	readonly programs: AppPlanFingerprint['httpRoutes']
	readonly bindingLayout: readonly ExternalBindingDescriptor[]
	readonly bindings: readonly unknown[]
	readonly validators: AppPlanAotValidatorManifest
	readonly wsRoutes: AppPlanAotWSManifest
}

export function createAppPlanAotPayload(plan: AppPlan): AppPlanAotPayload {
	return Object.freeze({
		format: AOT_MANIFEST_FORMAT,
		fingerprint: plan.fingerprint
	})
}

export const serializeAppPlanAot = (plan: AppPlan): string =>
	JSON.stringify(createAppPlanAotPayload(plan))

const key = (method: string, path: string, slot: string) =>
	`${method}\0${path}\0${slot}`

const sameValues = <T>(left: readonly T[], right: readonly T[]) =>
	left.length === right.length &&
	left.every((value, index) => value === right[index])

function assertRegistration(
	registration: ReturnType<typeof Compiled.pendingAppPlan>,
	appPlan = registration?.appPlan
) {
	if (!registration || !appPlan) return
	if (appPlan.payload.format !== AOT_MANIFEST_FORMAT)
		throw new Error(
			`[elysia-aot] Unsupported AppPlan manifest format: ${String(appPlan.payload.format)}.`
		)
	if (registration.fingerprint.abi !== appPlan.payload.fingerprint.abi)
		throw new Error('[elysia-aot] AppPlan manifest ABI mismatch.')
}

function assertValidatorImages(
	fingerprint: AppPlanFingerprint,
	images: AppPlanAotValidatorManifest
) {
	const expected = new Map<string, ValidatorSlotDescriptor>()
	for (const route of [...fingerprint.httpRoutes, ...fingerprint.wsRoutes]) {
		const method = 'method' in route ? route.method : 'WS'
		for (const validator of route.validators)
			expected.set(
				key(method, route.path, validator.slot),
				validator
			)
	}

	for (const method of Object.keys(images))
		for (const path of Object.keys(images[method]!))
			for (const slot of Object.keys(images[method]![path]!)) {
				const image = images[method]![path]![slot as ValidatorSlot]
				const identity = expected.get(key(method, path, slot))
				if (
					!image ||
					!identity ||
					!validatorSlotDescriptorsEqual(image.identity, identity)
				)
					throw new Error(
						'[elysia-aot] Validator image layout mismatch.'
					)
			}
}

function assertWSImages(
	fingerprint: AppPlanFingerprint,
	images: AppPlanAotWSManifest
) {
	const expected = new Map(
		fingerprint.wsRoutes.map((route) => [route.path, route.identity] as const)
	)
	const paths = Object.keys(images)
	for (const path of paths) {
		const identity = expected.get(path)
		const image = images[path]
		if (!identity || !image)
			throw new Error('[elysia-aot] WebSocket image path mismatch.')
		if (!programIdentitiesEqual(image.identity, identity))
			throw new Error('[elysia-aot] WebSocket image identity mismatch.')
		if (!sameValues(image.image.a, image.roles))
			throw new Error('[elysia-aot] WebSocket image role mismatch.')
	}
}

function snapshot<T>(value: T, seen = new WeakMap<object, unknown>()): T {
	if (!value || (typeof value !== 'object' && typeof value !== 'function'))
		return value
	if (typeof value === 'function') return value

	const prior = seen.get(value)
	if (prior) return prior as T
	const prototype = Object.getPrototypeOf(value)
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
		return value

	const copy: any = Array.isArray(value) ? [] : {}
	seen.set(value, copy)
	for (const key of Object.keys(value)) copy[key] = snapshot((value as any)[key], seen)
	return Object.freeze(copy)
}

/** Validate every identity and sidecar before exposing opaque live bindings. */
export function bindAppPlanAot(
	payload: AppPlanAotPayload,
	live: AppPlan,
	validators: AppPlanAotValidatorManifest = {},
	wsRoutes: AppPlanAotWSManifest = {}
): BoundAppPlanAotImage {
	if (payload.format !== AOT_MANIFEST_FORMAT)
		throw new Error(
			`[elysia-aot] Unsupported AppPlan manifest format: ${String(payload.format)}.`
		)

	assertAppPlanPublicationIdentity(live, payload.fingerprint)
	const boundValidators = snapshot(validators)
	const boundWSRoutes = snapshot(wsRoutes)
	assertValidatorImages(payload.fingerprint, boundValidators)
	assertWSImages(payload.fingerprint, boundWSRoutes)

	return Object.freeze({
		fingerprint: live.fingerprint,
		programs: live.fingerprint.httpRoutes,
		bindingLayout: live.bindingLayout,
		bindings: live.externalBindings,
		validators: boundValidators,
		wsRoutes: boundWSRoutes
	})
}

export interface PendingAppPlanAotClaim {
	readonly image: BoundAppPlanAotImage
	commit(): void
}

export interface AppPlanAotPlanningInputs {
	validatorImages(
		routeIndex: number,
		method: string,
		path: string
	): Partial<Record<ValidatorSlot, FrozenValidator>> | undefined
	wsValidatorImages(
		routeIndex: number,
		path: string
	): Partial<Record<ValidatorSlot, FrozenValidator>> | undefined
	claim(live: AppPlan): PendingAppPlanAotClaim
}

/** Resolve optional validator images by canonical program order, before live lowering. */
export function prepareAppPlanAotPlanningInputs():
	| AppPlanAotPlanningInputs
	| undefined {
	const registration = Compiled.pendingAppPlan()
	const pendingAppPlan = registration?.appPlan
	if (!pendingAppPlan) return
	const appPlan = snapshot(pendingAppPlan)
	assertRegistration(registration, appPlan)
	const validators = snapshot(appPlan.validators)
	const wsRoutes = snapshot(appPlan.wsRoutes)
	assertValidatorImages(appPlan.payload.fingerprint, validators)
	assertWSImages(appPlan.payload.fingerprint, wsRoutes)

	return Object.freeze({
		validatorImages(routeIndex: number, method: string, path: string) {
			const route = appPlan.payload.fingerprint.httpRoutes[routeIndex]
			if (!route || route.method !== method || route.path !== path)
				throw new Error('AppPlan fingerprint mismatch')
			let result:
				| Partial<Record<ValidatorSlot, FrozenValidator>>
				| undefined
			for (const validator of route.validators) {
				const image =
					validators[method]?.[path]?.[validator.slot]
				if (!image) continue
				;(result ??= {})[validator.slot as ValidatorSlot] = image.image
			}
			return result
		},
		wsValidatorImages(routeIndex: number, path: string) {
			const route = appPlan.payload.fingerprint.wsRoutes[routeIndex]
			if (!route || route.path !== path)
				throw new Error('AppPlan fingerprint mismatch')
			let result:
				| Partial<Record<ValidatorSlot, FrozenValidator>>
				| undefined
			for (const validator of route.validators) {
				const image =
					validators.WS?.[path]?.[validator.slot]
				if (!image) continue
				;(result ??= {})[validator.slot as ValidatorSlot] = image.image
			}
			return result
		},
		claim(live: AppPlan) {
			if (Compiled.pendingAppPlan() !== registration)
				throw new Error('[elysia-aot] AppPlan manifest claim conflict.')
			const image = bindAppPlanAot(
				appPlan.payload,
				live,
				validators,
				wsRoutes
			)
			return Object.freeze({
				image,
				commit() {
					if (!Compiled.claimValidated(registration))
						throw new Error(
							'[elysia-aot] AppPlan manifest claim conflict.'
						)
				}
			})
		}
	})
}
