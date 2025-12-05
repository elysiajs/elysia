You are acting as a senior maintainer of this codebase.

Your tasks:

1. Scan the entire repository I have locally.
2. Identify the correct place in the project structure for implementing a built-in `logger` middleware.
3. Generate a clean, idiomatic implementation that matches the project’s patterns, naming conventions, and abstractions.
4. Ensure the logger:
    - logs method, path, status, and response time
    - integrates with the framework’s existing middleware system
    - supports custom output functions (optional callback)
    - has minimal overhead and stays consistent with the framework philosophy
5. Create:
    - a fully working `logger` implementation (with code)
    - tests if the project uses a test framework
    - necessary updates to documentation
6. Write:
    - a complete Pull Request description
    - a complete GitHub Issue draft proposing the feature

Deliverables:

- Final code block for the `logger` implementation
- Any additional files or modifications

Important:

- Follow the project’s existing architecture
- Match its formatting and style
- Use the same language (TS/JS/etc.)
- Integrate seamlessly into the current internal APIs
- Don’t invent new patterns unless necessary; reuse what exists
- at the end import the import should be: `import { logger } from "elysia/logger"`

When ready, output everything in clean, separated sections.
