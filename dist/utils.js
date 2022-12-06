import { TypeCompiler } from '@sinclair/typebox/compiler';
export const SCHEMA = Symbol('schema');
export const mergeObjectArray = (a, b) => [
    ...(Array.isArray(a) ? a : [a]),
    ...(Array.isArray(b) ? b : [b])
];
export const mergeHook = (a, b) => {
    const aSchema = 'schema' in a ? a.schema : null;
    const bSchema = b && 'schema' in b ? b.schema : null;
    return {
        schema: aSchema || bSchema
            ? {
                // Merge local hook first
                body: bSchema?.body ?? aSchema?.body,
                header: bSchema?.headers ?? aSchema?.headers,
                params: bSchema?.params ?? aSchema?.params,
                query: bSchema?.query ?? aSchema?.query,
                response: bSchema?.response ?? aSchema?.response
            }
            : null,
        transform: mergeObjectArray(a.transform ?? [], b?.transform ?? []),
        beforeHandle: mergeObjectArray(a.beforeHandle ?? [], b?.beforeHandle ?? []),
        afterHandle: mergeObjectArray(a.afterHandle ?? [], b?.afterHandle ?? []),
        error: mergeObjectArray(a.error ?? [], b?.error ?? [])
    };
};
// export const isPromise = <T>(
// 	response: T | Promise<T>
// ): response is Promise<T> => response instanceof Promise
export const clone = (value) => [value][0];
export const getPath = (url) => {
    const queryIndex = url.indexOf('?');
    return url.substring(url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', 11), queryIndex === -1 ? url.length : queryIndex);
};
export const mapQuery = (url) => {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1)
        return {};
    const query = {};
    let paths = url.slice(queryIndex);
    while (true) {
        // Skip ?/&, and min length of query is 3, so start looking at 1 + 3
        const sep = paths.indexOf('&', 4);
        if (sep === -1) {
            const equal = paths.indexOf('=', 1);
            query[paths.slice(1, equal)] = paths.slice(equal + 1);
            break;
        }
        const path = paths.slice(0, sep);
        const equal = path.indexOf('=');
        query[path.slice(1, equal)] = path.slice(equal + 1);
        paths = paths.slice(sep);
    }
    return query;
};
const isObject = (item) => item && typeof item === 'object' && !Array.isArray(item);
// https://stackoverflow.com/a/37164538
export const mergeDeep = (target, source) => {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach((key) => {
            // @ts-ignore
            if (isObject(source[key])) {
                if (!(key in target))
                    // @ts-ignore
                    Object.assign(output, { [key]: source[key] });
                // @ts-ignore
                else
                    output[key] = mergeDeep(target[key], source[key]);
            }
            else {
                // @ts-ignore
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
};
export const createValidationError = (type, validator, value) => {
    const error = validator.Errors(value).next().value;
    return new Error('VALIDATION', {
        cause: `Invalid ${type}: '${error?.path?.slice(1) || "root"}'. ${error.message}`
    });
};
export const getSchemaValidator = (schema, additionalProperties = false) => {
    if (!schema)
        return;
    // @ts-ignore
    if (schema.type === 'object' && 'additionalProperties' in schema === false)
        schema.additionalProperties = additionalProperties;
    return TypeCompiler.Compile(schema);
};
