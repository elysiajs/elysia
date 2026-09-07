# Security Policy

**Do not open a public issue for security vulnerabilities.**

Please report privately via [GitHub Security Advisories](https://github.com/elysiajs/elysia/security/advisories/new).

Please include:

- A description of the vulnerability and its impact
- A minimal reproduction (an `Elysia` app + the request that triggers it)
- The affected version(s)

You should receive an initial response within 7 days. Once confirmed, a fix will be developed privately and released with a coordinated advisory. Credit is given to reporters unless anonymity is requested.

The advisory will be published publicly once patch is published after ~7 days and the issue will be closed. If you have any questions, please contact maintainers eg. [saltyaom@gmail.com](mailto:saltyaom@gmail.com).

## Scope

In scope:

- The `elysia` package (this repository)

Out of scope:

- Official plugins and ecosystem packages (report to their own repositories under [elysiajs](https://github.com/elysiajs))
- Vulnerabilities in Bun or other runtimes
- Issues requiring a malicious or misconfigured application (e.g. developer-controlled schemas or handlers), unless they cross a trust boundary for end-user input
