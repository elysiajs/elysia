import { validate } from './index'

import { concatArrayObject, mergeHook, parseHeader } from './utils'

import type { JSONSchema } from 'fluent-json-schema'
import type { Hook, Handler, TypedRoute, ParsedRequest } from './types'

const jsonHeader = {
    headers: {
        'Content-Type': 'application/json'
    }
}

export const runPreHandler = async <Store = Record<string, any>>(
    handlers: Handler<any, Store>[],
    request: Request,
    params,
    query,
    store,
    getBody: ParsedRequest['body']
) => {
    for (const preHandler of handlers) {
        const handled = await preHandler(
            {
                request,
                params,
                query,
                headers: () => parseHeader(request.headers),
                body: getBody
            },
            store
        )

        if (handled)
            switch (typeof handled) {
                case 'string':
                    return new Response(handled)

                case 'object':
                    try {
                        return new Response(JSON.stringify(handled), jsonHeader)
                    } catch (error) {
                        throw new error()
                    }

                case 'function':
                    return handled

                case 'number':
                case 'boolean':
                    return new Response(handled.toString())

                default:
                    break
            }
    }
}

export const createHandler =
    <
        Route extends TypedRoute = TypedRoute,
        Store extends Record<string, any> = Record<string, any>
    >(
        handler: Handler<Route, Store>,
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

        const createPrehandler = (h: Handler[]) =>
            runPreHandler(h, request, params, query, store, getBody)

        if (hook.transform[0]) {
            const preHandled = await createPrehandler(hook.transform)
            if (preHandled) return preHandled
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

        const response = await handler(
            {
                request,
                params,
                query,
                headers: () => parseHeader(request.headers),
                body: getBody
            },
            store
        )

        switch (typeof response) {
            case 'string':
                return new Response(response)

            case 'object':
                try {
                    return new Response(JSON.stringify(response), jsonHeader)
                } catch (error) {
                    throw new error()
                }

            case 'function':
                return response

            case 'number':
            case 'boolean':
                return new Response(response.toString())

            case 'undefined':
                return new Response('')

            default:
                return new Response(response)
        }
    }
