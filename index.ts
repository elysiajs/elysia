import validate from 'fluent-schema-validator'
import { type JSONSchema } from 'fluent-json-schema'

import Router, {
    type ParsedUrlQuery,
    type Handler as RawHandler,
    type HTTPMethod
} from './lib/find-my-world'

interface ParsedRequest {
    readonly request: Request
    query: ParsedUrlQuery
    params: Record<string, string | undefined>
    readonly headers: () => Record<string, string>
}

type EmptyHandler = (request: Request) => Response
type Handler<Store = Record<string, any>> = (
    request: Readonly<ParsedRequest>,
    store: Store
) => any

const jsonHeader = {
    headers: {
        'Content-Type': 'application/json'
    }
}

type HookEvent = 'onRequest' | 'preValidate' | 'preValidate'

type PreRequestHandler<Store = Record<string, any>> = (
    request: Readonly<Request>,
    store: Store
) => void

interface Hook<Store = Record<string, any>> {
    onRequest: PreRequestHandler<Store>[]
    preValidate: Handler<Store>[]
    preHandler: Handler<Store>[]
    schema: {
        body: JSONSchema[]
        header: JSONSchema[]
        query: JSONSchema[]
        params: JSONSchema[]
    }
}

interface Schemas {
    body?: JSONSchema | JSONSchema[]
    header?: JSONSchema | JSONSchema[]
    query?: JSONSchema | JSONSchema[]
    params?: JSONSchema | JSONSchema[]
}

interface RegisterHook<Store = Record<string, any>> {
    preHandler?: Handler<Store> | Handler<Store>[]
    preValidate?: Handler<Store> | Handler<Store>[]
    onRequest?: PreRequestHandler<Store> | PreRequestHandler<Store>[]
    schema?: Schemas
}

const runPreHandler = async <Store = Record<string, any>>(
    handlers: Handler<Store>[],
    request: Request,
    params,
    query,
    store
) => {
    for (const preHandler of handlers) {
        const handled = await preHandler(
            {
                request,
                params,
                query,
                headers: () => parseHeader(request.headers)
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

const createHandler =
    <Store extends Record<string, any>>(handler: Handler<Store>, hook: Hook) =>
    async (request: Request, params, query, store): Promise<Response> => {
        const createPrehandler = (h: Handler[]) =>
            runPreHandler(h, request, params, query, store)

        if (hook.preValidate[0]) {
            const preHandled = await createPrehandler(hook.preValidate)
            if (preHandled) return preHandled
        }

        if (
            hook.schema.body[0] ||
            hook.schema.header[0] ||
            hook.schema.params[0] ||
            hook.schema.query[0]
        ) {
            const createParser = async (value, schemas: JSONSchema[]) => {
                for (const schema of schemas)
                    try {
                        const validated = validate(value, schema)

                        if (!validated)
                            return new Response('Invalid Body', {
                                status: 400
                            })
                    } catch (error) {
                        return new Response('Unable to parse body', {
                            status: 422
                        })
                    }
            }

            if (hook.schema.body[0]) {
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

                const invalidBody = await createParser(
                    await getBody(),
                    hook.schema.body
                )
                if (invalidBody) return invalidBody
            }

            if (hook.schema.params[0]) {
                const invalidParams = await createParser(
                    query,
                    hook.schema.params
                )
                if (invalidParams) return invalidParams
            }

            if (hook.schema.query[0]) {
                const invalidQuery = await createParser(
                    query,
                    hook.schema.query
                )
                if (invalidQuery) return invalidQuery
            }

            if (hook.schema.header[0]) {
                const invalidHeader = await createParser(
                    params,
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
                headers: () => parseHeader(request.headers)
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

const parseHeader = (headers: Headers) => {
    const parsed = {}

    for (let [key, value] of headers.entries()) parsed[key] = value

    return parsed
}

export type Plugin<
    T = Object,
    PluginStore = Record<string, any>,
    InstanceStore extends Record<string, any> = {}
> = (
    app: KingWorld<PluginStore & InstanceStore>,
    config?: T
) => KingWorld<PluginStore & InstanceStore>

const concatArrayObject = <T>(a: T[], b: T | T[] | undefined): T[] =>
    b ? a.concat(b) : a

const mergeHook = <T>(
    a: Hook<T>,
    b?: Hook<T> | RegisterHook<T> | undefined
): Hook<T> => ({
    onRequest: concatArrayObject(a?.onRequest, b?.onRequest),
    preValidate: concatArrayObject(a?.preValidate, b?.preValidate),
    preHandler: concatArrayObject(a?.preHandler, b?.preHandler),
    schema: {
        body: concatArrayObject(a?.schema.body, b?.schema?.body),
        header: concatArrayObject(a?.schema.header, b?.schema?.header),
        query: concatArrayObject(a?.schema.query, b?.schema?.query),
        params: concatArrayObject(a?.schema.params, b?.schema?.params)
    }
})

export default class KingWorld<Store extends Record<string, any> = {}> {
    router: Router
    store: Store
    #ref: [keyof Store, any][]
    hook: Hook<Store>

    constructor() {
        this.router = new Router()
        this.store = {} as Store
        this.#ref = []
        this.hook = {
            onRequest: [],
            preValidate: [],
            preHandler: [],
            schema: {
                body: [],
                header: [],
                query: [],
                params: []
            }
        }
    }

    #addHandler(
        method: HTTPMethod,
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.router.on(
            method,
            path,
            createHandler<Store>(
                handler,
                mergeHook(this.hook as any, hook as any)
            ),
            this.store
        )
    }

    onRequest(handler: PreRequestHandler<Store>) {
        this.hook.onRequest.push(handler)

        return this
    }

    preValidate(handler: Handler<Store>) {
        this.hook.preHandler.push(handler)

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

    preHandler(handler: Handler<Store>) {
        this.hook.preHandler.push(handler)

        return this
    }

    when<Event extends HookEvent = HookEvent>(
        type: Event,
        handler: RegisterHook<Store>[Event]
    ) {
        switch (type) {
            case 'onRequest':
                this.hook.onRequest.push(handler as PreRequestHandler<Store>)

            case 'preValidate':
                this.hook.preValidate.push(handler as Handler<Store>)

            case 'preHandler':
                this.hook.preHandler.push(handler as Handler<Store>)
        }

        return this
    }

    group(prefix: string, run: (group: KingWorld<Store>) => void) {
        const instance = new KingWorld<Store>()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            this.#addHandler(method, `${prefix}${path}`, handler, instance.hook)
        })

        return this
    }

    guard(hook: RegisterHook<Store>, run: (group: KingWorld<Store>) => void) {
        const instance = new KingWorld<Store>()
        instance.hook = mergeHook(instance.hook)
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            this.#addHandler(method, path, handler, instance.hook)
        })

        return this
    }

    use<
        RefStore extends Record<string, any> = Store,
        Config = Object,
        PluginStore extends Record<string, any> = {}
    >(
        plugin: Plugin<Config, PluginStore, RefStore>,
        config?: Config
    ): KingWorld<PluginStore & Store> {
        return plugin(
            // ? Need hack, because instance need to have both type
            // ? but before transform type won't we available
            this as unknown as KingWorld<PluginStore & RefStore>,
            config
        ) as KingWorld<PluginStore & Store>
    }

    get(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('GET', path, handler, hook)

        return this
    }

    post(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('POST', path, handler, hook)

        return this
    }

    put(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('PUT', path, handler)

        return this
    }

    patch(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('PATCH', path, handler)

        return this
    }

    delete(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('DELETE', path, handler)

        return this
    }

    options(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('OPTIONS', path, handler)

        return this
    }

    head(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('HEAD', path, handler)

        return this
    }

    trace(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('TRACE', path, handler)

        return this
    }

    connect(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('CONNECT', path, handler)

        return this
    }

    on(
        method: HTTPMethod,
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook
    ) {
        this.#addHandler(method, path, handler, hook)

        return this
    }

    default(handler: EmptyHandler) {
        this.router.defaultRoute = handler

        return this
    }

    state(name: keyof Store, value: Store[keyof Store]) {
        this.store[name] = value

        return this
    }

    ref(
        name: keyof Store,
        value:
            | Store[keyof Store]
            | (() => Store[keyof Store])
            | (() => Promise<Store[keyof Store]>)
    ) {
        this.#ref.push([name as string, value])

        return this
    }

    listen(port: number) {
        // @ts-ignore
        if (!Bun) throw new Error('KINGWORLD required Bun to run')

        try {
            // @ts-ignore
            Bun.serve({
                port,
                fetch: async (request: Request) => {
                    const reference: Partial<Store> = {}

                    if (this.#ref[0])
                        for (const [key, value] of this.#ref)
                            reference[key] =
                                typeof value === 'function'
                                    ? Promise.resolve(value())
                                    : value

                    if (this.hook.onRequest[0])
                        for (const onRequest of this.hook.onRequest)
                            Promise.resolve(
                                onRequest(request, reference as Store)
                            )

                    return await this.router.lookup(request, reference)
                }
            })
        } catch (error) {
            throw new Error(error)
        }
    }
}
