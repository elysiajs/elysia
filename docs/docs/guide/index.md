# Getting Started

- This guide covers all aspects of Kingworld from the basics.

## Quick Start

KingWorld is a web framework based on [Bun](https://bun.sh).

```bash
bun add kingworld
```

Now create `index.ts`, and place the following:

```typescript
import KingWorld from 'kingworld'

new KingWorld().get('/', () => '🦊 Now foxing').listen(3000)
```

And run the server:

```bash
bun index.ts
```

Then simply open `http://localhost:3000` in your browser.

Congrats! You have just create a new web server in KingWorld 🎉🎉
