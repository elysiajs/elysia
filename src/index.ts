import validate from 'fluent-schema-validator'

import { createHandler } from './handler'
import { concatArrayObject, mergeHook, parseHeader } from './utils'

import Router, { type HTTPMethod } from './lib/find-my-world'

import type {
    Handler,
    EmptyHandler,
    Hook,
    HookEvent,
    RegisterHook,
    PreRequestHandler,
    TypedRoute,
    Schemas,
    Plugin
} from './types'

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
        handler: Handler<Route, Store>,
        hook?: RegisterHook<Route, Store>
    ) {
        this.router.on(
            method,
            path,
            createHandler<Route, Store>(
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

    transform(handler: Handler<Store>) {
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

            case 'transform':
                this.hook.transform.push(handler as Handler<Store>)

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

    guard(
        hook: RegisterHook<any, Store>,
        run: (group: KingWorld<Store>) => void
    ) {
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

    get<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Store>,
        hook?: RegisterHook<Route, Store>
    ) {
        this.#addHandler<Route>('GET', path, handler, hook)

        return this
    }

    post<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Store>,
        hook?: RegisterHook<Route, Store>
    ) {
        this.#addHandler<Route>('POST', path, handler, hook)

        return this
    }

    put<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('PUT', path, handler)

        return this
    }

    patch<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('PATCH', path, handler)

        return this
    }

    delete<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('DELETE', path, handler)

        return this
    }

    options<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('OPTIONS', path, handler)

        return this
    }

    head<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('HEAD', path, handler)

        return this
    }

    trace<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('TRACE', path, handler)

        return this
    }

    connect<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Store>,
        hook?: RegisterHook<Store>
    ) {
        this.#addHandler('CONNECT', path, handler)

        return this
    }

    on<Route extends TypedRoute = TypedRoute>(
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

    serverless = (request: Request) => {
        const reference: Partial<Store> = {}

        if (this.#ref[0])
            for (const [key, value] of this.#ref)
                reference[key] =
                    typeof value === 'function'
                        ? Promise.resolve(value())
                        : value

        if (this.hook.onRequest[0])
            for (const onRequest of this.hook.onRequest)
                Promise.resolve(onRequest(request, reference as Store))

        return this.router.lookup(request, reference)
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
