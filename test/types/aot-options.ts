import { Compiled, Manifest } from '../../src'
import * as CompiledModule from '../../src/compiled'
import type { ElysiaAotOptions } from '../../src/plugin/aot/core'

const removedFalse: ElysiaAotOptions = {
	// @ts-expect-error `strip` was removed; AOT always emits one AppPlan image.
	strip: false
}
const removedTrue: ElysiaAotOptions = {
	// @ts-expect-error `strip` was removed; AOT always emits one AppPlan image.
	strip: true
}
const removedAuto: ElysiaAotOptions = {
	// @ts-expect-error `strip` was removed; AOT always emits one AppPlan image.
	strip: 'auto'
}
const absentLazy: ElysiaAotOptions = {
	// @ts-expect-error Historical AOT lazy mode must not reappear.
	lazy: true
}
const absentThreshold: ElysiaAotOptions = {
	// @ts-expect-error Historical AOT threshold mode must not reappear.
	threshold: 1
}
const removedTreeShake: ElysiaAotOptions = {
	// @ts-expect-error Import schemas directly from `elysia/type` instead.
	treeShake: false
}

void [
	removedFalse,
	removedTrue,
	removedAuto,
	absentLazy,
	absentThreshold,
	removedTreeShake
]

// @ts-expect-error Handler capture was removed from the public manifest surface.
Manifest.handler
// @ts-expect-error Keyed handler lookup was removed from the compiled registry.
Compiled.getHandler
// @ts-expect-error Keyed manifest claims were removed; AppPlan claims validate atomically.
Compiled.claim
// @ts-expect-error Validator sidecars are supplied by the direct AppPlan image.
Compiled.getValidator
// @ts-expect-error WebSocket sidecars are supplied by the direct AppPlan image.
Compiled.getWSRoute
// @ts-expect-error Direct AppPlan claims leave no keyed program to release.
Compiled.release
// @ts-expect-error Handler sidecars were removed from `elysia/compiled`.
CompiledModule.handlers
// @ts-expect-error Handler sidecars are not a valid compiled registration.
Compiled.register({ bf: 1, fingerprint: { abi: '' }, handlers: {} })
