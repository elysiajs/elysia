import StringTheocracy, { type HTTPMethod } from './lib/string-theocracy/src'
import { removeDuplicateSlashes } from './lib/string-theocracy/src/utils'

import validate from 'fluent-schema-validator'

import { composePreHandler, composeHandler } from './handler'
import {
    concatArrayObject,
    mergeHook,
    parseHeader,
    isPromise,
    clone
} from './utils'

import type { JSONSchema } from 'fluent-json-schema'

import type {
    Handler,
    EmptyHandler,
    Hook,
    HookEvent,
    RegisterHook,
    PreRequestHandler,
    TypedRoute,
    Schemas,
    Plugin,
    ParsedRequest,
    KingWorldInstance,
    ComposedHandler
} from './types'

const jsonHeader = Object.freeze({
    headers: {
        'Content-Type': 'application/json'
    }
})

export default class KingWorld<
    Instance extends KingWorldInstance = KingWorldInstance
> {
    router: StringTheocracy<ComposedHandler>
    store: Instance['Store']
    #ref: [keyof Instance['Store'], any][]
    hook: Hook<Instance>

    constructor() {
        this.router = new StringTheocracy()
        this.store = {} as Instance['Store']
        this.#ref = []
        this.hook = {
            onRequest: [],
            transform: [],
            preHandler: [],
            schema: {
                body: [],
                header: [],
                query: [],
                params: []
            }
        }
    }

    #addHandler<Route extends TypedRoute = TypedRoute>(
        method: HTTPMethod,
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.router.on(
            method,
            path,
            composeHandler(
                handler,
                mergeHook(clone(this.hook) as Hook, hook as RegisterHook)
            )
        )
    }

    onRequest(handler: PreRequestHandler<Instance['Store']>) {
        this.hook.onRequest.push(handler)

        return this
    }

    transform(handler: Handler<{}, Instance>) {
        this.hook.transform.push(handler)

        return this
    }

    schema(schema: Schemas) {
        if (schema.body)
            this.hook.schema.body = this.hook.schema.body.concat(schema.body)

        if (schema.header)
            this.hook.schema.body = this.hook.schema.body.concat(schema.header)

        if (schema.params)
            this.hook.schema.params = this.hook.schema.body.concat(
                schema.params
            )

        if (schema.query)
            this.hook.schema.query = this.hook.schema.body.concat(schema.query)

        return this
    }

    preHandler(handler: Handler<{}, Instance>) {
        this.hook.preHandler.push(handler)

        return this
    }

    when<Event extends HookEvent = HookEvent>(
        type: Event,
        handler: RegisterHook<Instance['Store']>[Event]
    ) {
        switch (type) {
            case 'onRequest':
                this.hook.onRequest.push(
                    handler as PreRequestHandler<Instance['Store']>
                )

            case 'transform':
                this.hook.transform.push(handler as Handler<{}, Instance>)

            case 'preHandler':
                this.hook.preHandler.push(handler as Handler<{}, Instance>)
        }

        return this
    }

    group(prefix: string, run: (group: KingWorld<Instance>) => void) {
        const instance = new KingWorld<Instance>()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        Object.values(instance.router.routes).forEach(
            ({ method, path, handler }) => {
                this.router.on(
                    method,
                    removeDuplicateSlashes(`${prefix}/${path}`),
                    handler
                )
            }
        )

        return this
    }

    guard(
        hook: RegisterHook<any, Instance>,
        run: (group: KingWorld<Instance>) => void
    ) {
        const instance = new KingWorld<Instance>()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            this.router.on(method, path, handler)
        })

        return this
    }

    use<
        CurrentInstance extends KingWorldInstance = Instance,
        Config = Object,
        PluginInstance extends KingWorldInstance = KingWorldInstance
    >(
        plugin: Plugin<Config, PluginInstance, CurrentInstance>,
        config?: Config
    ): KingWorld<Instance & PluginInstance> {
        // ? Need hack, because instance need to have both type
        // ? but before transform type won't we available
        return plugin(this as any, config) as any
    }

    get<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('GET', path, handler, hook)

        return this
    }

    post<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('POST', path, handler, hook)

        return this
    }

    put<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('PUT', path, handler)

        return this
    }

    patch<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('PATCH', path, handler)

        return this
    }

    delete<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('DELETE', path, handler)

        return this
    }

    options<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('OPTIONS', path, handler)

        return this
    }

    head<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('HEAD', path, handler)

        return this
    }

    trace<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('TRACE', path, handler)

        return this
    }

    connect<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('CONNECT', path, handler)

        return this
    }

    on<Route extends TypedRoute = TypedRoute>(
        method: HTTPMethod,
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler(method, path, handler, hook)

        return this
    }

    default(handler: EmptyHandler) {
        this.router.default(handler)

        return this
    }

    state(
        name: keyof Instance['Store'],
        value: Instance['Store'][keyof Instance['Store']]
    ) {
        this.store[name] = value

        return this
    }

    ref(
        name: keyof Instance['Store'],
        value:
            | Instance['Store'][keyof Instance['Store']]
            | (() => Instance['Store'][keyof Instance['Store']])
            | (() => Promise<Instance['Store'][keyof Instance['Store']]>)
    ) {
        this.#ref.push([name, value])

        return this
    }

    serverless = async (request: Request) => {
        const reference: Partial<Instance['Store']> = Object.assign(
            {},
            this.store
        )

        if (this.#ref[0])
            for (const [key, value] of this.#ref)
                reference[key] =
                    typeof value === 'function'
                        ? Promise.resolve(value())
                        : value

        if (this.hook.onRequest[0])
            for (const onRequest of this.hook.onRequest)
                Promise.resolve(onRequest(request, reference))

        const {
            found,
            method,
            path,
            handler: [handler, hook],
            params,
            query
        } = this.router.find(request.method as HTTPMethod, request.url)

        const store = Object.assign(this.store, reference)

        let body: string | Object
        const getBody = async () => {
            if (body) return body

            body = await Promise.resolve(
                request
                    .text()
                    .then((body) =>
                        body.startsWith('{') || body.startsWith('[')
                            ? JSON.parse(body)
                            : body
                    )
            )

            return body
        }

        if (!found) return (handler as unknown as EmptyHandler)(request)

        // ? Might have additional field attach from plugin, so forced type cast here
        const parsedRequest: ParsedRequest = {
            request,
            params,
            query,
            headers: () => parseHeader(request.headers),
            body: getBody,
            responseHeader: {}
        } as ParsedRequest

        const runPreHandler = (h: Handler[]) =>
            composePreHandler<Instance>(h, parsedRequest, store)

        if (hook.transform[0]) {
            const transformed = await runPreHandler(hook.transform)
            if (transformed) return transformed
        }

        if (
            hook.schema.body[0] ||
            hook.schema.header[0] ||
            hook.schema.params[0] ||
            hook.schema.query[0]
        ) {
            const createParser = (
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
                const invalidBody = createParser(
                    'body',
                    await getBody(),
                    hook.schema.body
                )
                if (invalidBody) return invalidBody
            }

            if (hook.schema.params[0]) {
                const invalidParams = createParser(
                    'params',
                    params,
                    hook.schema.params
                )
                if (invalidParams) return invalidParams
            }

            if (hook.schema.query[0]) {
                const invalidQuery = createParser(
                    'query',
                    query,
                    hook.schema.query
                )
                if (invalidQuery) return invalidQuery
            }

            if (hook.schema.header[0]) {
                const invalidHeader = createParser(
                    'headers',
                    parseHeader(request.headers),
                    hook.schema.header
                )
                if (invalidHeader) return invalidHeader
            }
        }

        if (hook.preHandler[0]) {
            const preHandled = await runPreHandler(hook.preHandler)
            if (preHandled) return preHandled
        }

        let response = handler(parsedRequest, this.store)
        if (isPromise(response)) response = await response

        switch (typeof response) {
            case 'string':
                return new Response(response)

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

                for (const [key, value] of Object.entries(
                    parsedRequest.responseHeader
                ))
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

    listen(port: number) {
        // @ts-ignore
        if (!Bun) throw new Error('KINGWORLD required Bun to run')

        try {
            // @ts-ignore
            Bun.serve({
                port,
                fetch: this.serverless
            })
        } catch (error) {
            throw new Error(error)
        }
    }
}

export { validate }

export type {
    Handler,
    EmptyHandler,
    Hook,
    HookEvent,
    RegisterHook,
    ParsedRequest,
    PreRequestHandler,
    TypedRoute,
    Schemas,
    Plugin
} from './types'
