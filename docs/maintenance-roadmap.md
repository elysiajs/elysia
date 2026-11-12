# Maintenance Roadmap

This document proposes a stability-first maintenance track for Elysia. It is
not a release plan; it is a shared checklist for deciding which maintenance
work has the highest leverage.

## Goals

- Keep Elysia fast without making correctness depend on one execution path.
- Treat type inference as part of the public contract.
- Make runtime boundary behavior predictable across Bun, Node, and custom
  adapters.
- Turn recurring issue patterns into small regression suites.

## Focus Areas

### AOT and Dynamic Parity

Elysia has both precompiled and dynamic request handlers. Bugs often appear
when behavior is fixed in one path but not the other. A parity checklist should
cover:

- lifecycle order and short-circuit behavior
- response mapping and validation
- cookies, headers, redirects, and custom status responses
- error propagation and `onError`
- file, stream, and range responses

Each bug fix touching request handling should include either one shared test or
paired AOT/dynamic tests.

### Type Inference Contract

Type-level regressions are high impact because users choose Elysia for
end-to-end TypeScript safety. The most sensitive areas are:

- macros and `resolve`
- route input/output exposure
- Standard Schema providers
- custom status responses
- guard, group, and plugin composition

Regression tests should live near the affected type suites and encode reported
issue examples as minimal compile-time checks.

### Runtime Boundary Behavior

Elysia should preserve platform-native semantics unless it intentionally wraps
them. Maintenance work should verify:

- `Response` objects keep stream, file, status, and header behavior intact
- `Request` data remains available through lifecycle hooks
- range/file responses work with Bun-native APIs
- adapter behavior is documented when parity is impossible

This is where Elysia competes with Go, Java, and Rust web stacks on reliability,
not only raw throughput.

### Parser and Security Hardening

Automatic parsing is a productivity feature, but parser edges need a defensive
contract:

- query and form-data parsing should not allow prototype pollution
- content-type detection should be explicit and testable
- malformed inputs should fail closed
- normalization should not erase data needed by validators

Security reports should create minimal fixtures that remain in the suite after
the fix.

### Observability and Debuggability

Warnings are useful only when they point to an actionable source. For internal
inference and compilation warnings:

- include the feature area and hook name when possible
- avoid noisy warnings for recoverable parser states
- keep internal fallback behavior conservative
- add debug output behind opt-in settings when logs would be too verbose

### Issue Triage Loop

Open issues can be grouped into stable lanes:

- correctness bugs with reproduction
- type inference regressions
- adapter/runtime boundary issues
- security-sensitive parser behavior
- external plugin issues
- feature requests and RFCs

For issues with enough detail, prefer a small failing test PR first. For issues
without enough detail, request a minimal reproduction and close the loop with a
label or comment.

## Suggested First Milestones

1. Add an AOT/dynamic parity checklist to PR review.
2. Convert recent type regression issues into compile-time tests.
3. Build focused regression tests for native `Response`, `Bun.file`, streams,
   and range handling.
4. Harden query and form-data parser tests against prototype pollution.
5. Add a lightweight issue label guide for maintainers and contributors.

## Non-goals

- Rewriting the framework in another language.
- Replacing Bun-specific strengths with lowest-common-denominator behavior.
- Adding large features before stabilizing the contracts above.
