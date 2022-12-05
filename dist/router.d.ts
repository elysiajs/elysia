/**
 * MIT License
 *
 * Copyright (c) 2022 SaltyAom
 * Copyright (c) 2019 Medley
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * @see https://github.com/medleyjs/router
 */
export interface FindResult {
    store: Record<string, any>;
    params: Record<string, any>;
}
export interface ParametricNode {
    paramName: string;
    store: Record<string, any> | null;
    staticChild: Node | null;
}
export interface Node {
    pathPart: string;
    store: Record<string, any> | null;
    staticChildren: Map<any, any> | null;
    parametricChild: ParametricNode | null;
    wildcardStore: Map<number, any> | null;
}
export declare class Router {
    private _root;
    register(path: string): any;
    find(url: string): FindResult | null;
}
