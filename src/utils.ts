import { Kind, TSchema } from "@sinclair/typebox";
import { TypeCheck, TypeCompiler } from "@sinclair/typebox/compiler";
import type {
  DeepMergeTwoTypes,
  LifeCycleStore,
  LocalHook,
  TypedSchema,
  RegisteredHook,
} from "./types";

// ? Internal property
export const SCHEMA = Symbol("schema");
export const DEFS = Symbol("definitions");
export const EXPOSED = Symbol("exposed");

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => [
  ...(Array.isArray(a) ? a : [a]),
  ...(Array.isArray(b) ? b : [b]),
];

export const mergeHook = (
  a: LocalHook<any, any> | LifeCycleStore<any>,
  b: LocalHook<any, any>
): RegisteredHook<any> => {
  return {
    // Merge local hook first
    // @ts-ignore
    body: b?.body ?? a?.body,
    // @ts-ignore
    headers: b?.headers ?? a?.headers,
    // @ts-ignore
    params: b?.params ?? a?.params,
    // @ts-ignore
    query: b?.query ?? a?.query,
    // @ts-ignore
    response: b?.response ?? a?.response,
    detail: mergeDeep(
      // @ts-ignore
      b?.detail ?? {},
      // @ts-ignore
      a?.detail ?? {}
    ),
    transform: mergeObjectArray(a.transform ?? [], b?.transform ?? []) as any,
    beforeHandle: mergeObjectArray(a.beforeHandle ?? [], b?.beforeHandle ?? []),
    parse: mergeObjectArray((a.parse as any) ?? [], b?.parse ?? []),
    afterHandle: mergeObjectArray(a.afterHandle ?? [], b?.afterHandle ?? []),
    error: mergeObjectArray(a.error ?? [], b?.error ?? []),
    type: a?.type || b?.type,
  };
};

const isObject = (item: any): item is Object =>
  item && typeof item === "object" && !Array.isArray(item);

// https://stackoverflow.com/a/37164538
export const mergeDeep = <A extends Object = Object, B extends Object = Object>(
  target: A,
  source: B
): DeepMergeTwoTypes<A, B> => {
  const output: Partial<DeepMergeTwoTypes<A, B>> = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      // @ts-ignore
      if (isObject(source[key])) {
        if (!(key in target))
          // @ts-ignore
          Object.assign(output, { [key]: source[key] });
        // @ts-ignore
        else output[key] = mergeDeep(target[key], source[key]);
      } else {
        // @ts-ignore
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output as DeepMergeTwoTypes<A, B>;
};

export const getSchemaValidator = (
  s: TSchema | string | undefined,
  models: Record<string, TSchema>,
  additionalProperties = false
) => {
  if (!s) return;
  if (typeof s === "string" && !(s in models)) return;

  const schema: TSchema = typeof s === "string" ? models[s] : s;

  // @ts-ignore
  if (schema.type === "object" && "additionalProperties" in schema === false)
    schema.additionalProperties = additionalProperties;

  return TypeCompiler.Compile(schema);
};

export const getResponseSchemaValidator = (
  s: TypedSchema["response"] | undefined,
  models: Record<string, TSchema>,
  additionalProperties = false
): Record<number, TypeCheck<any>> | undefined => {
  if (!s) return;
  if (typeof s === "string" && !(s in models)) return;

  const maybeSchemaOrRecord = typeof s === "string" ? models[s] : s;

  if (Kind in maybeSchemaOrRecord)
    return {
      200: TypeCompiler.Compile(maybeSchemaOrRecord),
    };

  const record: Record<number, TypeCheck<any>> = {};

  Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
    const maybeNameOrSchema = maybeSchemaOrRecord[status];

    if (typeof maybeNameOrSchema === "string") {
      if (maybeNameOrSchema in models) {
        const schema = models[maybeNameOrSchema];
        schema.type === "object" && "additionalProperties" in schema === false;

        // Inherits model maybe already compiled
        record[+status] =
          Kind in schema ? TypeCompiler.Compile(schema) : schema;
      }

      return undefined;
    }

    if (
      maybeNameOrSchema.type === "object" &&
      "additionalProperties" in maybeNameOrSchema === false
    )
      maybeNameOrSchema.additionalProperties = additionalProperties;

    // Inherits model maybe already compiled
    record[+status] =
      Kind in maybeNameOrSchema
        ? TypeCompiler.Compile(maybeNameOrSchema)
        : maybeNameOrSchema;
  });

  return record;
};
