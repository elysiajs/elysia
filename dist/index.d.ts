/// <reference types="bun-types" />
import type { Serve, Server } from 'bun';
import type { Context } from './context';
import type { Handler, BeforeRequestHandler, TypedRoute, ElysiaInstance, ElysiaConfig, HTTPMethod, InternalRoute, BodyParser, ErrorHandler, TypedSchema, LocalHook, LocalHandler, LifeCycle, LifeCycleEvent, LifeCycleStore, VoidLifeCycle, AfterRequestHandler, MergeIfNotNull, IsAny, OverwritableTypeRoute, MergeSchema, ListenCallback } from './types';
/**
 * ### Elysia Server
 * Main instance to create web server using Elysia
 *
 * ---
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 *
 * new Elysia()
 *     .get("/", () => "Hello")
 *     .listen(8080)
 * ```
 */
export default class Elysia<Instance extends ElysiaInstance = ElysiaInstance<{
    store: {};
    request: {};
    schema: {};
}>> {
    config: ElysiaConfig;
    store: Instance['store'];
    decorators: Record<string, unknown> | undefined;
    event: LifeCycleStore<Instance>;
    server: Server | null;
    private $schema;
    private router;
    protected routes: InternalRoute<Instance>[];
    constructor(config?: Partial<ElysiaConfig>);
    private _addHandler;
    /**
     * ### start | Life cycle event
     * Called after server is ready for serving
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onStart(({ url, port }) => {
     *         console.log("Running at ${url}:${port}")
     *     })
     *     .listen(8080)
     * ```
     */
    onStart(handler: VoidLifeCycle<Instance>): this;
    /**
     * ### request | Life cycle event
     * Called on every new request is accepted
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onRequest(({ method, url }) => {
     *         saveToAnalytic({ method, url })
     *     })
     * ```
     */
    onRequest(handler: BeforeRequestHandler<Instance['store']>): this;
    /**
     * ### parse | Life cycle event
     * Callback function to handle body parsing
     *
     * If truthy value is returned, will be assigned to `context.body`
     * Otherwise will skip the callback and look for the next one.
     *
     * Equivalent to Express's body parser
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onParse((request, contentType) => {
     *         if(contentType === "application/json")
     *             return request.json()
     *     })
     * ```
     */
    onParse(parser: BodyParser): this;
    /**
     * ### transform | Life cycle event
     * Assign or transform anything related to context before validation.
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onTransform(({ params }) => {
     *         if(params.id)
     *             params.id = +params.id
     *     })
     * ```
     */
    onTransform<Route extends OverwritableTypeRoute = TypedRoute>(handler: Handler<Route, Instance>): this;
    /**
     * ### Before Handle | Life cycle event
     * Intercept request **before(()) main handler is called.
     *
     * If truthy value is returned, will be assigned as `Response` and skip the main handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onBeforeHandle(({ params: { id }, status }) => {
     *         if(id && !isExisted(id)) {
     * 	           status(401)
     *
     *             return "Unauthorized"
     * 	       }
     *     })
     * ```
     */
    onBeforeHandle<Route extends OverwritableTypeRoute = TypedRoute>(handler: Handler<Route, Instance>): this;
    /**
     * ### After Handle | Life cycle event
     * Intercept request **after** main handler is called.
     *
     * If truthy value is returned, will be assigned as `Response`
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onAfterHandle((context, response) => {
     *         if(typeof response === "object")
     *             return JSON.stringify(response)
     *     })
     * ```
     */
    onAfterHandle<Route extends OverwritableTypeRoute = TypedRoute>(handler: AfterRequestHandler<Route, Instance>): this;
    /**
     * ### Error | Life cycle event
     * Called when error is thrown during processing request
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onError(({ code }) => {
     *         if(code === "NOT_FOUND")
     *             return "Path not found :("
     *     })
     * ```
     */
    onError(errorHandler: ErrorHandler): this;
    /**
     * ### stop | Life cycle event
     * Called after server stop serving request
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onStop((app) => {
     *         cleanup()
     *     })
     * ```
     */
    onStop(handler: VoidLifeCycle<Instance>): this;
    /**
     * ### on
     * Syntax sugar for attaching life cycle event by name
     *
     * Does the exact same thing as `.on[Event]()`
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .on('error', ({ code }) => {
     *         if(code === "NOT_FOUND")
     *             return "Path not found :("
     *     })
     * ```
     */
    on<Event extends LifeCycleEvent = LifeCycleEvent>(type: Event, handler: LifeCycle<Instance>[Event]): this;
    /**
     * ### group
     * Encapsulate and group path with prefix
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .group('/v1', app => app
     *         .get('/', () => 'Hi')
     *         .get('/name', () => 'Elysia')
     *     })
     * ```
     */
    group(prefix: string, run: (group: Elysia<Instance>) => void): this;
    /**
     * ### guard
     * Encapsulate and pass hook into all child handler
     *
     * ---
     * @example
     * ```typescript
     * import { t } from 'elysia'
     *
     * new Elysia()
     *     .guard({
     *          schema: {
     *              body: t.Object({
     *                  username: t.String(),
     *                  password: t.String()
     *              })
     *          }
     *     }, app => app
     *         .get("/", () => 'Hi')
     *         .get("/name", () => 'Elysia')
     *     })
     * ```
     */
    guard<Schema extends TypedSchema = {}>(hook: LocalHook<Schema, Instance>, run: (group: Elysia<{
        request: Instance['request'];
        store: Instance['store'];
        schema: MergeIfNotNull<Schema, Instance['schema']>;
    }>) => void): this;
    /**
     * ### use
     * Merge separate logic of Elysia with current
     *
     * ---
     * @example
     * ```typescript
     * const plugin = (app: Elysia) => app
     *     .get('/plugin', () => 'hi')
     *
     * new Elysia()
     *     .use(plugin)
     * ```
     */
    use<NewElysia extends Elysia<any> = Elysia<any>, Params extends Elysia = Elysia<any>>(plugin: (app: Params extends Elysia<infer ParamsInstance> ? IsAny<ParamsInstance> extends true ? this : Params : Params) => NewElysia): NewElysia extends Elysia<infer NewInstance> ? Elysia<NewInstance & Instance> : this;
    /**
     * ### get
     * Register handler for path with method [GET]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .get('/', () => 'hi')
     *     .get('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    get<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### post
     * Register handler for path with method [POST]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .post('/', () => 'hi')
     *     .post('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    post<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### put
     * Register handler for path with method [PUT]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .put('/', () => 'hi')
     *     .put('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    put<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### patch
     * Register handler for path with method [PATCH]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .patch('/', () => 'hi')
     *     .patch('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    patch<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### delete
     * Register handler for path with method [DELETE]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .delete('/', () => 'hi')
     *     .delete('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    delete<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### options
     * Register handler for path with method [OPTIONS]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .options('/', () => 'hi')
     *     .options('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    options<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### post
     * Register handler for path with any method
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .all('/', () => 'hi')
     * ```
     */
    all<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### head
     * Register handler for path with method [HEAD]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .head('/', () => 'hi')
     *     .head('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    head<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### trace
     * Register handler for path with method [TRACE]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .trace('/', () => 'hi')
     *     .trace('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    trace<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### connect
     * Register handler for path with method [CONNECT]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .connect('/', () => 'hi')
     *     .connect('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    connect<Schema extends TypedSchema = {}, Path extends string = string>(path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * @deprecated
     *
     * Use `route` instead
     */
    method<Schema extends TypedSchema = {}, Path extends string = string>(method: HTTPMethod, path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): void;
    /**
     * ### route
     * Register handler for path with custom method
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .route('CUSTOM', '/', () => 'hi')
     *     .route('CUSTOM', '/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    route<Schema extends TypedSchema = {}, Path extends string = string>(method: HTTPMethod, path: Path, handler: LocalHandler<Schema, Instance, Path>, hook?: LocalHook<Schema, Instance, Path>): this;
    /**
     * ### state
     * Assign global mutatable state accessible for all handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .state('counter', 0)
     *     .get('/', (({ counter }) => ++counter)
     * ```
     */
    state<Key extends string | number | symbol = keyof Instance['store'], Value = Instance['store'][keyof Instance['store']], ReturnValue = Value extends () => infer Returned ? Returned extends Promise<infer AsyncReturned> ? AsyncReturned : Returned : Value, NewInstance = Elysia<{
        store: Instance['store'] & {
            [key in Key]: ReturnValue;
        };
        request: Instance['request'];
        schema: Instance['schema'];
    }>>(name: Key, value: Value): NewInstance;
    /**
     * ### decorate
     * Define custom method to `Context` accessible for all handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .decorate('getDate', () => Date.now())
     *     .get('/', (({ getDate }) => getDate())
     * ```
     */
    decorate<Name extends string, Value = any, NewInstance = Elysia<{
        store: Instance['store'];
        request: Instance['request'] & {
            [key in Name]: Value;
        };
        schema: Instance['schema'];
    }>>(name: Name, value: Value): NewInstance;
    /**
     * Create derived property from Context
     *
     * ---
     * @example
     * new Elysia()
     *     .state('counter', 1)
     *     .derive((store) => ({
     *         multiplied: () => store().counter * 2
     *     }))
     */
    derive<Returned extends Record<string | number | symbol, () => any> = Record<string | number | symbol, () => any>>(transform: (store: () => Readonly<Instance['store']>) => Returned): Elysia<{
        store: Instance['store'] & Returned;
        request: Instance['request'];
        schema: Instance['schema'];
    }>;
    /**
     * Assign property which required access to Context
     *
     * ---
     * @example
     * new Elysia()
     *     .state('counter', 1)
     *     .inject(({ store }) => ({
     *         increase() {
     *             store.counter++
     *         }
     *     }))
     */
    inject<Returned extends Object = Object>(transform: (context: Context<{}, Instance['store']> & Instance['request']) => Returned extends {
        store: any;
    } ? never : Returned): Elysia<{
        store: Instance['store'];
        request: Instance['request'] & Returned;
        schema: Instance['schema'];
    }>;
    /**
     * ### schema
     * Define type strict validation for request
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .schema({
     *         response: t.String()
     *     })
     *     .get('/', () => 'hi')
     * ```
     */
    schema<Schema extends TypedSchema = TypedSchema, NewInstance = Elysia<{
        request: Instance['request'];
        store: Instance['store'];
        schema: MergeSchema<Schema, Instance['schema']>;
    }>>(schema: Schema): NewInstance;
    handle(request: Request): Promise<Response>;
    private handleError;
    /**
     * ### listen
     * Assign current instance to port and start serving
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .get("/", () => 'hi')
     *     .listen(8080)
     * ```
     */
    listen(options: string | number | Serve, callback?: ListenCallback): this;
    /**
     * ### stop
     * Stop server from serving
     *
     * ---
     * @example
     * ```typescript
     * const app = new Elysia()
     *     .get("/", () => 'hi')
     *     .listen(8080)
     *
     * // Sometime later
     * app.stop()
     * ```
     */
    stop: () => Promise<void>;
}
export { Elysia };
export { Type as t } from '@sinclair/typebox';
export { SCHEMA, getPath, createValidationError, getSchemaValidator } from './utils';
export { Router } from './router';
export type { Context } from './context';
export type { Handler, RegisteredHook, BeforeRequestHandler, TypedRoute, OverwritableTypeRoute, ElysiaInstance, ElysiaConfig, HTTPMethod, ComposedHandler, InternalRoute, BodyParser, ErrorHandler, ErrorCode, TypedSchema, LocalHook, LocalHandler, LifeCycle, LifeCycleEvent, AfterRequestHandler, HookHandler, TypedSchemaToRoute, UnwrapSchema, LifeCycleStore, VoidLifeCycle, SchemaValidator } from './types';
