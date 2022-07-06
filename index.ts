import Router, {
    type ParsedUrlQuery,
    type Handler as RawHandler,
    type HTTPMethod
} from './lib/find-my-world'

interface KWRequest {
    readonly request: Request
    readonly query: ParsedUrlQuery
    readonly params: Record<string, string | undefined>
    readonly headers: () => Record<string, string>
}

type EmptyHandler = (request: Request) => Response
type Handler<Store = Record<string, any>> = (
    request: KWRequest,
    store: Store
) => any

const jsonHeader = {
    headers: {
        'Content-Type': 'application/json'
    }
}

type HookEvent = 'preHandler' | 'onRequest'

type PreRequestHandler<Store = Record<string, any>> = (
    request: Request,
    store: Store
) => void

interface Hook<Store = Record<string, any>> {
    preHandler: Handler<Store>[]
    onRequest: PreRequestHandler[]
}

interface RegisterHook<Store = Record<string, any>> {
    preHandler?: Handler<Store> | Handler<Store>[]
    onRequest?: PreRequestHandler | PreRequestHandler[]
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
        const createPrehandler = (handlers: Handler[]) =>
            runPreHandler(handlers, request, params, query, store)

        if (hook.preHandler[0]) {
            const preHandled = await createPrehandler(hook.preHandler)
            if (preHandled) return preHandled
        }

        const response = handler(
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
    b: Hook<T> | RegisterHook<T> | undefined
): Hook<T> => ({
    preHandler: concatArrayObject(a?.preHandler, b?.preHandler),
    onRequest: concatArrayObject(a?.onRequest, b?.onRequest)
})

export default class KingWorld<Store extends Record<string, any> = {}> {
    router: Router
    store: Store
    #reference: [string, any][]
    hook: Hook<Store>

    constructor() {
        this.router = new Router()
        this.store = {} as Store
        this.#reference = []
        this.hook = {
            preHandler: [],
            onRequest: []
        }
    }

    #addHandler(
        method: HTTPMethod,
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.router.on<Store>(
            method,
            path,
            createHandler<Store>(
                handler,
                mergeHook(this.hook as any, hook as any)
            ),
            this.store
        )
    }

    when<Event extends HookEvent>(
        type: Event,
        handler: RegisterHook<Store>[Event]
    ) {
        switch (type) {
            case 'preHandler':
                this.hook.preHandler.push(handler as any)

            case 'onRequest':
                this.hook.onRequest.push(handler as PreRequestHandler)
        }

        return this
    }

    group(prefix: string, run: (group: KingWorld<Store>) => void) {
        const instance = new KingWorld<Store>()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            // @ts-ignore
            this.#addHandler(method, `${prefix}${path}`, handler, instance.hook)
        })

        return this
    }

    register<RefStore extends Record<string, any> = Store, Config = Object, PluginStore extends Record<string, any> = {}>(
        plugin: Plugin<Config, PluginStore, RefStore>,
        config?: Config
    ): KingWorld<PluginStore & Store> {
        return plugin(
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

    purge(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('PURGE', path, handler)

        return this
    }

    move(path: string, handler: Handler<Store>, hook?: RegisterHook<Store>) {
        this.#addHandler('MOVE', path, handler)

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
        value: Store[keyof Store] | (() => Store[keyof Store])
    ) {
        this.#reference.push([name as string, value])

        return this
    }

    listen(port: number) {
        // @ts-ignore
        if (!Bun) throw new Error('KINGWORLD required Bun to run')

        try {
            // @ts-ignore
            Bun.serve({
                port,
                fetch: (request: Request) => {
                    const reference = {}

                    if (this.#reference[0])
                        this.#reference.forEach(
                            ([key, value]) =>
                                (reference[key] =
                                    'call' in value ? value() : value)
                        )

                    if (this.hook.onRequest[0])
                        for (const onRequest of this.hook.onRequest)
                            onRequest(request, reference)

                    return this.router.lookup(request, reference)
                }
            })
        } catch (error) {
            throw new Error(error)
        }
    }
}
