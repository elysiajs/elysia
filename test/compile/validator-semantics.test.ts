import { describe, expect, it } from 'bun:test'
import type { CapturedValidator } from '../../src/compile/aot'
import { createQueryPlan, isFrameworkQueryPlan } from '../../src/parse-query'
import { t } from '../../src/type'
import {
	VALIDATION_PLAN_FUSED_QUERY,
	VALIDATION_PLAN_ORACLE
} from '../../src/type/constants'
import {
	appPlanFingerprintsEqual,
	canonicalPlanValue,
	createAppPlan,
	type HttpRoutePlanInput
} from '../../src/compile/app-plan'
import {
	captureStandardValidatorSemantics,
	capturedValidatorSemantics,
	compositionProjectionSemantics,
	composedValidatorSemantics,
	createValidatorSlotInput,
	queryPlanSemantics,
	runtimeTypeBoxValidatorSemantics,
	validationPlanSemantics,
	validatorArtifactSettlement,
	validatorSemanticMembers,
	validatorSemantics,
	validatorSettlement,
	type TypeBoxExecutionPolicy
} from '../../src/compile/validator-semantics'
import { Validator } from '../../src/validator'
import {
	attachValidatorSemanticSource,
	readValidatorSemanticSource
} from '../../src/validator/semantic-channel'
import { readRouteQueryPlan, RouteValidator } from '../../src/validator/route'
import { validationPlan } from '../../src/validator/validation-plan'

const handler = () => 'ok'
const captured = (value = 'return value.id === 1'): CapturedValidator => ({
	method: 'POST',
	path: '/',
	slot: 'body',
	identifier: 'External',
	checkDefs: '',
	checkValue: value,
	external: true,
	decodeMirror: {
		source: 'return d.codecs[0](value)',
		hasExternals: true
	},
	hasCodec: true,
	bridgeFree: true
})
const policy: TypeBoxExecutionPolicy = {
	normalize: 'exact',
	sanitize: false,
	direction: 'request',
	domain: 'body',
	settlement: 'sync',
	clean: 'runtime',
	optional: 'none',
	form: false,
	noValidate: false,
	diagnostics: 'locator'
}

const route = (
	validators: HttpRoutePlanInput['validators']
): HttpRoutePlanInput => ({
	method: 'POST',
	path: '/',
	handlerForm: 'function',
	program: {
		version: 1,
		content: {},
		bindings: [{ role: 'handler', value: handler }]
	},
	validators
})

const plan = (validators: HttpRoutePlanInput['validators']) =>
	createAppPlan({
		abi: 'validator-test:1',
		application: {
			fetch: {},
			lifecycle: {}
		},
		adapter: { target: 'web-standard' },
		httpRoutes: [route(validators)]
	})

describe('validator semantics', () => {
	it('reattaches identical frozen semantics and rejects sealed drift', () => {
		const validator = Validator.create(t.Object({ id: t.String() }), {
			slot: 'body',
			schemas: [
				{
					'~standard': {
						version: 1,
						vendor: 'sealed-composition',
						validate: (value: unknown) => ({ value })
					}
				} as any
			],
			normalize: false
		})!
		validator.seal(false)
		const original = validatorSemantics(validator)
		createValidatorSlotInput('body', original, { validator })

		expect(() => validator.seal(false)).not.toThrow()
		expect(readValidatorSemanticSource(validator)).toBe(original)
		expect(() =>
			attachValidatorSemanticSource(
				validator,
				canonicalPlanValue({ kind: 'changed-after-seal' })
			)
		).toThrow('Validator semantic source changed after sealing')
	})

	it('fingerprints captured check, codec, and callback layout semantics', () => {
		const executor = {}
		const make = (artifact: CapturedValidator) =>
			plan([
				createValidatorSlotInput(
					'body',
					capturedValidatorSemantics(artifact, policy),
					{ validator: executor }
				)
			])

		const base = make(captured())
		const same = make({ ...captured(), method: 'PUT', path: '/other' })
		const changedCheck = make(captured('return value.id === 2'))
		const changedCodec = make({
			...captured(),
			decodeMirror: {
				source: 'return d.codecs[1](value)',
				hasExternals: true
			}
		})

		expect(
			appPlanFingerprintsEqual(base.fingerprint, same.fingerprint)
		).toBe(true)
		expect(
			appPlanFingerprintsEqual(base.fingerprint, changedCheck.fingerprint)
		).toBe(false)
		expect(
			appPlanFingerprintsEqual(base.fingerprint, changedCodec.fingerprint)
		).toBe(false)
		expect(base.bindingLayout.at(-1)).toEqual({
			nodeId: 1,
			role: 'bodyValidator',
			ordinal: 0
		})
		expect((base.externalBindings.at(-1) as any).validator).toBe(executor)
		expect(
			validatorArtifactSettlement(
				base.httpRoutes[0]!.validators[0]!.artifact
			)
		).toBe('sync')
	})

	it('keeps Standard Schema callbacks opaque while fingerprinting their contract', () => {
		const standard = (vendor: string, validate: Function) => ({
			'~standard': { version: 1, vendor, validate }
		})
		const first = standard('example', () => ({ value: 1 }))
		const second = standard('example', () => ({ issues: [] }))
		const different = standard('other', () => ({ value: 1 }))
		const make = (schema: ReturnType<typeof standard>) =>
			(() => {
				const { semantics, validate } =
					captureStandardValidatorSemantics(schema)
				return plan([
					createValidatorSlotInput('query', semantics, {
						validator: { validate },
						queryPlan: createQueryPlan(undefined)
					})
				])
			})()

		expect(
			appPlanFingerprintsEqual(
				make(first).fingerprint,
				make(second).fingerprint
			)
		).toBe(true)
		expect(
			appPlanFingerprintsEqual(
				make(first).fingerprint,
				make(different).fingerprint
			)
		).toBe(false)
	})

	it('owns every response status as a distinct immutable slot without schema retention', () => {
		const raw = captured()
		const capturedWithAuthoringMetadata = {
			...raw,
			// Future capture metadata must not leak into the plan by accident.
			schema: { retained: true }
		} as CapturedValidator
		const semantics = capturedValidatorSemantics(
			capturedWithAuthoringMetadata,
			policy
		)
		const responseSemantics = capturedValidatorSemantics(
			capturedWithAuthoringMetadata,
			{
				...policy,
				direction: 'response',
				domain: 'response'
			}
		)
		const validators = [200, 422].map((status) =>
			createValidatorSlotInput(`response:${status}`, responseSemantics, {
				validator: {}
			})
		)
		const image = plan(validators)

		expect(image.httpRoutes[0]!.validators.map(({ slot }) => slot)).toEqual(
			['response:200', 'response:422']
		)
		expect(JSON.stringify(image.fingerprint)).not.toContain('retained')
		expect(Object.isFrozen(semantics)).toBe(true)
		expect(Object.isFrozen((semantics as any).image.decodeMirror)).toBe(
			true
		)

		raw.checkValue = 'changed after projection'
		expect(JSON.stringify(image.fingerprint)).not.toContain(
			'changed after projection'
		)
	})

	it('rejects incomplete Standard Schema and empty slot semantics at seal input', () => {
		expect(() =>
			captureStandardValidatorSemantics({
				'~standard': { version: 1, vendor: 'missing-callback' }
			})
		).toThrow('invalid Standard Schema')
		expect(() =>
			capturedValidatorSemantics(
				{
					method: 'POST',
					path: '/',
					slot: 'body'
				},
				policy
			)
		).toThrow('incomplete captured validator')
		expect(() =>
			createValidatorSlotInput('body', {}, { validator: {} })
		).toThrow('invalid validator semantics')
		expect(() =>
			createValidatorSlotInput(
				'body',
				capturedValidatorSemantics(captured(), policy),
				{ validator: { schema: { retained: true } } }
			)
		).toThrow('not detached')
	})

	it('includes effective policy, ordered composition, and Standard maybe-settlement', () => {
		const exact = capturedValidatorSemantics(captured(), policy)
		const none = capturedValidatorSemantics(captured(), {
			...policy,
			normalize: 'none',
			clean: 'none'
		})
		const sanitized = capturedValidatorSemantics(captured(), {
			...policy,
			sanitize: true
		})
		expect(exact).not.toEqual(none)
		expect(exact).not.toEqual(sanitized)

		const standard = captureStandardValidatorSemantics({
			'~standard': {
				version: 1,
				vendor: 'plain-thenable',
				validate: () => ({ then() {} })
			}
		}).semantics
		expect(validatorSettlement(standard)).toBe('maybe')

		const forward = composedValidatorSemantics('validation-plan', [
			{ semantics: exact, projection: null },
			{
				semantics: standard,
				projection: compositionProjectionSemantics({
					remove: new Set(['private'])
				})
			}
		])
		const reverse = composedValidatorSemantics('validation-plan', [
			{
				semantics: standard,
				projection: compositionProjectionSemantics({
					remove: new Set(['private'])
				})
			},
			{ semantics: exact, projection: null }
		])
		expect(forward).not.toEqual(reverse)
		expect(validatorSettlement(forward)).toBe('maybe')
		expect(() => composedValidatorSemantics('legacy', [])).toThrow(
			'missing composed validator semantics'
		)
	})

	it('reads effective multi order and projections from the existing executors', () => {
		const standard = {
			'~standard': {
				version: 1,
				vendor: 'composition',
				validate: (value: unknown) => ({ value })
			}
		}
		const left = t.Object({ left: t.String() })
		const right = t.Object({ right: t.String() })
		const legacy = Validator.create(left, {
			schemas: [standard as any, right],
			normalize: false
		})!
		expect(
			validatorSemanticMembers(legacy).map(({ typebox }) => typebox)
		).toEqual([false, true])

		const planned = validationPlan.compose(left, {
			schemas: [right],
			normalize: false
		} as any)!
		const members = validatorSemanticMembers(planned)
		expect(members.map(({ typebox }) => typebox)).toEqual([true, true])
		expect(members[0]!.projection?.remove).toEqual(['right'])
		expect(members[1]!.projection?.remove).toEqual(['left'])
	})

	it('projects validation and query plans into versioned plain identity data', () => {
		const validation = validationPlanSemantics(
			{
				coerced: true,
				hasDefault: false,
				root: {
					pc: 0,
					kind: 1,
					optional: false,
					hasDefault: false,
					keys: ['id'],
					known: new Set(['id']),
					required: new Set(['id']),
					additional: 2,
					string: false,
					properties: [
						{
							pc: 1,
							kind: 4,
							optional: false,
							hasDefault: false,
							integer: true,
							coerce: 1,
							explicit: false
						}
					]
				}
			} as any,
			policy
		)
		expect((validation as any).image.root.known).toEqual(['id'])
		expect((validation as any).image.root.known).not.toBeInstanceOf(Set)

		const generic = queryPlanSemantics(
			createQueryPlan({
				type: 'object',
				properties: {
					ids: { type: 'array', items: { type: 'string' } },
					tags: { type: 'array', items: { type: 'string' } }
				}
			})
		)
		expect(generic).toEqual({
			version: 1,
			kind: 'generic',
			array: ['ids', 'tags'],
			object: []
		})

		const scalarRoot = {
			kind: 1,
			optional: false,
			string: false,
			min: undefined,
			max: undefined,
			keys: ['id'],
			properties: [
				{
					kind: 4,
					integer: true,
					coerce: 1,
					explicit: false,
					hasDefault: false
				}
			],
			additional: 2,
			required: new Set(['id'])
		}
		const scalar = queryPlanSemantics(
			createQueryPlan(
				{},
				{
					[VALIDATION_PLAN_FUSED_QUERY]: true,
					isAsync: false,
					mayReturnPromise: false,
					From() {},
					[VALIDATION_PLAN_ORACLE]() {},
					plan: { root: scalarRoot }
				},
				true
			)
		)
		expect(scalar).toMatchObject({
			version: 1,
			kind: 'scalar',
			fields: [{ key: 'id', kind: 6, hasDefault: false }]
		})
		expect(() =>
			queryPlanSemantics({
				parse() {
					return {}
				}
			} as any)
		).toThrow('not planner-owned')
	})

	it('preserves observable numeric defaults and snapshots executor state', () => {
		const makeDefault = (defaultValue: number) =>
			validationPlanSemantics(
				{
					coerced: false,
					hasDefault: true,
					root: {
						pc: 0,
						kind: 4,
						optional: false,
						hasDefault: true,
						defaultValue,
						integer: false,
						coerce: 0,
						explicit: false
					}
				} as any,
				policy
			)
		expect(makeDefault(-0)).not.toEqual(makeDefault(0))
		expect(makeDefault(Array(1) as any)).not.toEqual(
			makeDefault([undefined] as any)
		)

		const original = { validator: {} as object }
		const slot = createValidatorSlotInput(
			'body',
			capturedValidatorSemantics(captured(), policy),
			original
		)
		const bound = slot.bindings![0]!.value as any
		original.validator = { replaced: true }
		expect(bound.validator).not.toBe(original.validator)
		expect(Object.isFrozen(bound)).toBe(true)
		expect(Object.isFrozen(bound.validator)).toBe(true)
	})

	it('keeps immutable generic and fused query bindings planner-certified', () => {
		const queryPolicy: TypeBoxExecutionPolicy = {
			...policy,
			domain: 'query'
		}
		const semantics = capturedValidatorSemantics(captured(), queryPolicy)
		const generic = createQueryPlan({
			type: 'object',
			properties: {
				ids: { type: 'array', items: { type: 'string' } }
			}
		})
		const genericSlot = createValidatorSlotInput('query', semantics, {
			validator: {},
			queryPlan: generic
		})
		const app = plan([genericSlot])
		const genericBinding = app.externalBindings.find(
			(value: any) => value?.queryPlan
		) as any
		expect(isFrameworkQueryPlan(genericBinding.queryPlan)).toBe(true)
		const recreatedGeneric = createValidatorSlotInput(
			'query',
			semantics,
			genericBinding
		)
		expect(recreatedGeneric.content).toEqual(genericSlot.content)

		const scalarRoot = {
			kind: 1,
			optional: false,
			string: false,
			keys: ['id'],
			properties: [
				{
					kind: 4,
					integer: true,
					coerce: 1,
					explicit: false,
					hasDefault: false
				}
			],
			additional: 2,
			required: new Set(['id'])
		}
		const fused = createQueryPlan(
			{},
			{
				[VALIDATION_PLAN_FUSED_QUERY]: true,
				isAsync: false,
				mayReturnPromise: false,
				From() {},
				[VALIDATION_PLAN_ORACLE]() {},
				plan: { root: scalarRoot }
			},
			true
		)
		const fusedSlot = createValidatorSlotInput('query', semantics, {
			validator: {},
			queryPlan: fused
		})
		const fusedBinding = fusedSlot.bindings![0]!.value as any
		expect(isFrameworkQueryPlan(fusedBinding.queryPlan)).toBe(true)
		const recreatedFused = createValidatorSlotInput(
			'query',
			semantics,
			fusedBinding
		)
		expect(recreatedFused.content).toEqual(fusedSlot.content)
		expect(
			isFrameworkQueryPlan(
				(recreatedFused.bindings![0]!.value as any).queryPlan
			)
		).toBe(true)
	})

	it('captures exact semantics on constructed TypeBox, Standard, and response validators', () => {
		const body = t.Object({
			id: t.Numeric(),
			name: t.Refine(t.String(), (value) => value.length > 0)
		})
		const validator = Validator.create(body, {
			slot: 'body',
			normalize: 'typebox',
			sanitize: { response: true } as any
		})!
		const semantics = validatorSemantics(validator) as any

		expect(semantics).toMatchObject({
			kind: 'typebox',
			policy: {
				direction: 'request',
				domain: 'body',
				normalize: 'typebox',
				sanitize: true,
				diagnostics: 'locator'
			},
			image: {
				format: 'effective-schema-json-v1',
				hasCodec: true
			}
		})
		expect(JSON.stringify(semantics)).toContain('external')
		expect(Object.isFrozen(semantics)).toBe(true)
		const otherSanitize = Validator.create(body, {
			slot: 'body',
			normalize: 'typebox',
			sanitize: { response: false } as any
		})!
		expect(validatorSemantics(otherSanitize)).not.toEqual(semantics)

		validator.seal(true)
		expect((validator as any).schema).toBeUndefined()
		expect((validatorSemantics(validator) as any).policy.diagnostics).toBe(
			'compact'
		)

		const standard = Validator.create({
			'~standard': {
				version: 1,
				vendor: 'construction-test',
				validate: (value: unknown) => ({ value })
			}
		} as any)!
		expect(validatorSemantics(standard)).toMatchObject({
			kind: 'standard',
			vendor: 'construction-test'
		})
		expect(
			() =>
				new (standard.constructor as any)({
					'~standard': {
						vendor: undefined,
						validate: (value: unknown) => ({ value })
					}
				})
		).not.toThrow()

		const responses = Validator.response({
			200: t.Numeric(),
			422: t.Object({ message: t.String() })
		})!
		expect(
			Object.entries(responses).map(([status, current]) => [
				status,
				(validatorSemantics(current) as any).policy
			])
		).toMatchObject([
			['200', { direction: 'response', domain: 'response' }],
			['422', { direction: 'response', domain: 'response' }]
		])
		expect(
			(validatorSemantics(responses[200]!) as any).image
		).toMatchObject({
			hasCodec: true,
			codecDirection: 'encode'
		})
		const encodedBeforeSeal = (responses[200] as any).EncodeFrom(1)
		responses[200]!.seal(false)
		expect((responses[200] as any).EncodeFrom(1)).toEqual(encodedBeforeSeal)

		let reads = 0
		const firstValidate = (value: unknown) => ({ value })
		const standardWithGetter = Object.defineProperty({}, '~standard', {
			get() {
				reads++
				return reads === 1
					? {
							version: 1,
							vendor: 'retained',
							validate: firstValidate
						}
					: {
							version: 1,
							vendor: 'classification-only',
							validate: firstValidate
						}
			}
		})
		const getterValidator = Validator.create(standardWithGetter as any)!
		expect(reads).toBe(2)
		expect(validatorSemantics(getterValidator)).toMatchObject({
			vendor: 'retained'
		})

		let accessorReads = 0
		const accessorSchema = Object.defineProperty({}, 'type', {
			get() {
				accessorReads++
				return 'string'
			}
		})
		runtimeTypeBoxValidatorSemantics(accessorSchema, policy, {
			hasCodec: false,
			hasDefault: false,
			hasRef: false,
			codecDirection: 'none'
		})
		expect(accessorReads).toBe(0)

		Validator.clear()
		const shared = t.String()
		const bodySlot = Validator.create(shared, { slot: 'body' })!
		const querySlot = Validator.create(shared, { slot: 'query' })!
		expect(querySlot).not.toBe(bodySlot)
		expect((validatorSemantics(querySlot) as any).policy.domain).toBe(
			'query'
		)
	})

	it('captures ValidationPlan IR and exact composed child semantics in effective order', () => {
		const left = t.Object({ left: t.String() })
		const right = t.Object({ right: t.Number() })
		const standard = {
			'~standard': {
				version: 1,
				vendor: 'composed-source',
				validate: (value: unknown) => ({ value })
			}
		}

		const legacy = Validator.create(left, {
			slot: 'body',
			schemas: [standard as any, right],
			normalize: false
		})!
		const legacySemantics = validatorSemantics(legacy) as any
		expect(legacySemantics.kind).toBe('multi')
		expect(legacySemantics.merge).toBe('legacy')
		expect(
			legacySemantics.members.map(({ semantics }: any) => semantics.kind)
		).toEqual(['standard', 'typebox'])

		const responseComposed = Validator.response(t.Numeric(), {
			schemas: [{ 200: standard as any }],
			normalize: false
		})![200]!
		const responseComposedSemantics = validatorSemantics(
			responseComposed
		) as any
		expect(responseComposedSemantics.merge).toBe('legacy')
		expect(
			responseComposedSemantics.members.find(
				({ semantics }: any) => semantics.kind === 'typebox'
			).semantics
		).toMatchObject({
			policy: { direction: 'response', domain: 'response' },
			image: { hasCodec: true, codecDirection: 'decode' }
		})

		const composed = validationPlan.compose(left, {
			slot: 'body',
			schemas: [right],
			normalize: false
		} as any)!
		const composedSemantics = validatorSemantics(composed) as any
		expect(composedSemantics.merge).toBe('validation-plan')
		expect(composedSemantics.members[0].projection.remove).toEqual([
			'right'
		])
		expect(composedSemantics.members[1].projection.remove).toEqual(['left'])

		const stringNumber = () =>
			t
				.Codec(t.String())
				.Decode((value) => Number(value))
				.Encode((value) => String(value))
		const responsePlanned = validationPlan.compose(
			t.Object({ left: stringNumber() }),
			{
				semanticSlot: 'response:200',
				schemas: [t.Object({ right: stringNumber() })],
				normalize: false
			} as any
		)!
		const responsePlannedSemantics = validatorSemantics(
			responsePlanned
		) as any
		expect(
			responsePlannedSemantics.members.map(
				({ semantics }: any) => semantics.image.codecDirection
			)
		).toEqual(['encode', 'encode'])
		const responseValue = { left: 1, right: 2 }
		const encodedComposed = (responsePlanned as any).EncodeFrom(
			responseValue
		)
		responsePlanned.seal(false)
		expect((responsePlanned as any).EncodeFrom(responseValue)).toEqual(
			encodedComposed
		)
		expect(() =>
			createValidatorSlotInput(
				'response:200',
				validatorSemantics(responsePlanned),
				{ validator: responsePlanned }
			)
		).not.toThrow()

		const planned = Validator.create(t.Object({ id: t.Number() }), {
			slot: 'query',
			validationPlan
		})!
		const plannedSemantics = validatorSemantics(planned) as any
		expect(plannedSemantics).toMatchObject({
			kind: 'validation-plan',
			policy: { direction: 'request', domain: 'query' }
		})
		expect(Array.isArray(plannedSemantics.image.root)).toBe(false)
	})

	it('owns a certified generic query plan without the ValidationPlan experiment', () => {
		const route = new RouteValidator({
			query: t.Object({ ids: t.Array(t.String()) })
		})
		expect(route.queryPlan).toBeUndefined()
		const queryPlan = readRouteQueryPlan(route)
		expect(queryPlan).toBeDefined()
		route.query!.seal(false)
		expect(() =>
			createValidatorSlotInput(
				'query',
				validatorSemantics(route.query!),
				{
					validator: route.query!,
					queryPlan
				}
			)
		).not.toThrow()
	})
})
