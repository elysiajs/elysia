import { Elysia } from 'elysia'

// DEFECT 2 (vacuous seal, purest form): an app with ZERO routes/handlers. The
// old gate sealed on `[].every()` vacuous truth. A seal must rest on real
// coverage (>= 1 captured handler), so a zero-capture app must NOT be sealed.
export const app = new Elysia()
