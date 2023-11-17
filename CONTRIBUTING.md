# Welcome to Elysia.js contributing guide

Thank you for investing your time in contributing to Elysia.js! Any contribution you make will be amazing :sparkles:.

Read our [Code of Conduct](./CODE_OF_CONDUCT.md) to keep our community approachable and respectable.

In this guide you will get an overview of the contribution workflow from opening an issue, creating a PR, reviewing, and merging the PR.

## Setup Local Development Environment

The Elysia.js repo is using [bun](https://bun.sh). Make sure you have the [latest version of bun](https://github.com/oven-sh/bun/releases) installed in your system. To run Elysia.js locally:

1. Clone this repository

2. In the root of this project, run `bun install` to install all of the necessary dependencies

3. To run the development version, run `bun run dev`

### Unit Testing

In Elysia.js, all of the test files are located inside the [`test/`](test/) directory. Unit testing are powered by [bun's test](https://github.com/oven-sh/bun/tree/main/packages/bun-internal-test).

-   `bun test` to run all the test inside the [`test/`](test/) directory

-   `bun test test/<test-file>.ts` to run a specific test

## Pull Request Guidelines

-   Checkout a topic branch from a base branch (e.g. `main`), and merge back against that branch.

-   If adding a new feature:

    -   Add accompanying test case if possible.

    -   Provide a convincing reason to add this feature. Ideally, you should open a suggestion issue first, and have it approved before working on it.

-   If fixing a bug:

    -   If you are resolving a special issue, please add the issues number in the PR's description.

    -   Provide a detailed description of the bug in the PR. Live demo preferred.

    -   Add appropriate test coverage if applicable.

-   It's OK to have multiple small commits as you work on the PR. GitHub can automatically squash them before merging.

## Thanks :purple_heart:

Thanks for all your contributions and efforts towards improving Elysia.js. We thank you for being part of our :sparkles: community :sparkles:!
