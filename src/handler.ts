import { validate } from './index'

import { concatArrayObject, mergeHook, parseHeader } from './utils'

import type { JSONSchema } from 'fluent-json-schema'
import type {
    Hook,
    Handler,
    TypedRoute,
    ParsedRequest,
    KingWorldInstance,
    CreateHandler
} from './types'

const jsonHeader = {
    headers: {
        'Content-Type': 'application/json'
    }
}

export const runPreHandler = async <
    Instance extends KingWorldInstance = KingWorldInstance
>(
    handlers: Handler<any, Instance>[],
    request: ParsedRequest & Instance['Request'],
    store: Instance['Store']
) => {
    for (const preHandler of handlers) {
        const response = await preHandler(request, store)

        if (response)
            switch (typeof response) {
                case 'string':
                        return new Response(response, {
                            headers: request.responseHeader,
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

export const createHandler: CreateHandler =
    <
        Route extends TypedRoute = TypedRoute,
        Instance extends KingWorldInstance = KingWorldInstance
    >(
        handler: Handler<Route, Instance>,
        hook: Hook
    ) =>
    async (request: Request, params, query, store): Promise<Response> => {
        let body: string | Object
        const getBody = async () => {
            if (body) return body

            let _body = await request.text()
            body =
                _body.startsWith('{') || _body.startsWith('[')
                    ? JSON.parse(_body)
                    : _body

            // @ts-ignore
            request.body = body
            // @ts-ignore
            request.bodyUsed = true

            return body
        }

        // ? Might have additional field attach from plugin, so forced type cast here
        const parsedRequest: ParsedRequest<Route> = {
            request,
            params,
            query,
            headers: () => parseHeader(request.headers),
            body: getBody,
            responseHeader: {}
        } as ParsedRequest<Route>

        const createPrehandler = (h: Handler[]) =>
            runPreHandler<Instance>(h, parsedRequest, store)

        if (hook.transform[0]) {
            const transformed = await createPrehandler(hook.transform)
            if (transformed) return transformed
        }

        if (
            hook.schema.body[0] ||
            hook.schema.header[0] ||
            hook.schema.params[0] ||
            hook.schema.query[0]
        ) {
            const createParser = async (
                type: string,
                value,
                schemas: JSONSchema[]
            ) => {
                for (const schema of schemas)
                    try {
                        const validated = validate(value, schema)

                        if (!validated)
                            return new Response(`Invalid ${type}`, {
                                status: 400
                            })
                    } catch (error) {
                        return new Response(`Unable to parse ${type}`, {
                            status: 422
                        })
                    }
            }

            if (hook.schema.body[0]) {
                const invalidBody = await createParser(
                    'body',
                    await getBody(),
                    hook.schema.body
                )
                if (invalidBody) return invalidBody
            }

            if (hook.schema.params[0]) {
                const invalidParams = await createParser(
                    'params',
                    params,
                    hook.schema.params
                )
                if (invalidParams) return invalidParams
            }

            if (hook.schema.query[0]) {
                const invalidQuery = await createParser(
                    'query',
                    query,
                    hook.schema.query
                )
                if (invalidQuery) return invalidQuery
            }

            if (hook.schema.header[0]) {
                const invalidHeader = await createParser(
                    'headers',
                    parseHeader(request.headers),
                    hook.schema.header
                )
                if (invalidHeader) return invalidHeader
            }
        }

        if (hook.preHandler[0]) {
            const preHandled = await createPrehandler(hook.preHandler)
            if (preHandled) return preHandled
        }

        const response = await handler(parsedRequest, store)

        switch (typeof response) {
            case 'string':
                return new Response(response, {
                    headers: parsedRequest.responseHeader
                })

            case 'object':
                try {
                    return new Response(
                        JSON.stringify(response),
                        Object.assign(jsonHeader, {
                            headers: parsedRequest.responseHeader
                        })
                    )
                } catch (error) {
                    throw new error()
                }

            case 'function':
                const res = response as Response

                for (const [
                    key,
                    value
                ] of parsedRequest.responseHeader.entries())
                    res.headers.append(key, value)

                return res

            case 'number':
            case 'boolean':
                return new Response(response.toString(), {
                    headers: parsedRequest.responseHeader
                })

            case 'undefined':
                return new Response('', {
                    headers: parsedRequest.responseHeader
                })

            default:
                return new Response(response, {
                    headers: parsedRequest.responseHeader
                })
        }
    }
