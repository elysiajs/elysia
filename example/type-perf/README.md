# Type inference benchmarks

```sh
bun run build
bun run example/type-perf/measure.ts [N=50] [package|source]
bun run example/type-perf/lsp.ts [N=50] [package|source]
```

Both default to the built package declarations. `source` includes checking the
framework implementation, which adds contributor cost that package consumers do
not pay. Build first so package results describe current code.

`measure.ts` runs the installed TypeScript compiler with `--extendedDiagnostics`
for three apps: distinct inline schemas, identical inline schemas, and one named
model reused across routes. It reports total instantiations and the difference
from an empty app. Every compiler invocation must succeed and return valid
counters. At the default 50 routes, the regression check requires named models
to cost less than distinct inline schemas. Other route counts report comparisons
without that assumption, since model registration adds fixed overhead. These
comparisons do not isolate TypeScript's caching mechanism.

`lsp.ts` runs TypeScript's LanguageService under Bun. Before each request it
changes a field in the last route's body schema, supplies the exact incremental
text-change range, and verifies the resulting hover or completion. It measures
body hover, `body.` completion, app hover, and `app.` completion. Output includes
cold startup, ten samples per operation,
median, and p95. Run it several times on an idle machine before drawing latency
conclusions. It measures in-process LanguageService work, not editor transport
or extension overhead.
