export declare const req: (path: string, options?: RequestInit) => import("undici-types").Request;
type MaybeArray<T> = T | T[];
export declare const upload: (path: string, fields: Record<string, MaybeArray<(string & {}) | "aris-yuzu.jpg" | "midori.png" | "millenium.jpg">>) => {
    request: import("undici-types").Request;
    size: number;
};
export declare const post: (path: string, body?: Record<string, any>) => import("undici-types").Request;
export declare const delay: (delay: number) => Promise<unknown>;
export {};
