import Elysia from "../../src";

export const lazy = (app: Elysia) => app.state('a', 'b').get('/lazy', () => 'Hi')

export default lazy
