import { validate } from './index'
import { concatArrayObject, isPromise, mergeHook, parseHeader } from './utils'

import type { JSONSchema } from 'fluent-json-schema'
import type { ParsedUrlQuery } from 'querystring'

import type {
    Hook,
    Handler,
    TypedRoute,
    ParsedRequest,
    KingWorldInstance,
    RegisterHook,
    ComposedHandler
} from './types'

const jsonHeader = Object.freeze({
    headers: {
        'Content-Type': 'application/json'
    }
})

export const composePreHandler = async <
    Instance extends KingWorldInstance = KingWorldInstance
>(
    handlers: Handler<any, Instance>[],
    request: ParsedRequest & Instance['Request'],
    store: Instance['Store']
) => {
    for (const preHandler of handlers) {
        let response = preHandler(request, store)
        response = isPromise(response) ? await response : response

        if (response)
            switch (typeof response) {
                case 'string':
                    return new Response(response, {
                        headers: request.responseHeader
                    })

                case 'object':
                    try {
                        return new Response(
                            JSON.stringify(response),
                            Object.assign(jsonHeader, {
                                headers: request.responseHeader
                            })
                        )
                    } catch (error) {
                        throw new error()
                    }

                case 'function':
                    const res = response as Response

                    for (const [key, value] of Object.entries(
                        request.responseHeader
                    ))
                        res.headers.append(key, value)

                    return res

                case 'number':
                case 'boolean':
                    return new Response(response.toString(), {
                        headers: request.responseHeader
                    })

                default:
                    break
            }
    }
}

// Currying to merge hook
export const composeHandler =
    (handler: Handler<any, any>, hook: Hook<any>): ComposedHandler => [handler, hook]
