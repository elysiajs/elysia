import { Elysia } from '../../src'
import * as Handler from '../../src/compile/handler'
import * as Runtime from '../../src/compile/handler/runtime'
import * as Descriptor from '../../src/compile/handler/descriptor'

// @ts-expect-error the legacy handler source generator module was deleted
import type {} from '../../src/compile/handler/jit'
// @ts-expect-error positional JIT dependency reconstruction was deleted
import type {} from '../../src/compile/handler/params'
// @ts-expect-error the JIT reachability probe was deleted with the JIT
import type {} from '../../src/compile/jit-probe'

const app = new Elysia()
// @ts-expect-error declaration-indexed legacy compilation is not public API
app.handler(0)

// @ts-expect-error legacy compiler export was deleted
Handler.compileHandler
// @ts-expect-error capture-time JIT source switch was deleted
Handler.setCaptureHeaderShorthand
// @ts-expect-error the JIT-to-balanced compatibility seam was deleted
Runtime.compileBalancedHttpRouteFromJit
// @ts-expect-error Generation.plan replaces the descriptor side cache
Descriptor.routeDescriptors
