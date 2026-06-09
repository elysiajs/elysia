# Welcome to Elysia contributing guide

Thank you for investing your time in contributing to Elysia! Any contribution you make will be amazing :sparkles:.

Read our [Code of Conduct](./CODE_OF_CONDUCT.md) to keep our community approachable and respectable.

In this guide you will get an overview of the contribution workflow from opening an issue, creating a PR, reviewing, and merging the PR.

## Setup Local Development Environment

Elysia test cases are using [bun](https://bun.sh). Make sure you have the [latest version of bun](https://github.com/oven-sh/bun/releases) installed in your system.

To run Elysia locally:

1. Clone this repository
2. run `bun install` in project's root
3. Run development with `bun run dev`

### Unit Testing

All of the test files are located inside the [`test/`](test/) directory. Unit testing are powered by [bun's test](https://github.com/oven-sh/bun/tree/main/packages/bun-internal-test).

- `bun test` to run all the test inside the [`test/`](test/) directory
- `bun test test/<test-file>.ts` to run a specific test

## Pull Request Guidelines

Recommended to use `main` branch as a base to work on.

#### General Recommendation
- Please kindly verify that you have run test suite before request a review from maintainers with `bun run test`
- We do not condone the usage of any form of plagiarism or copying code without proper attribution.
- We do not tolerate disrespectful or inappropriate behavior within the community.
- AI generated pull request without human interaction, review and supervision may result in close without further notice or ban from future contribution to Elysia.

#### Adding New Features
- Provide a reason why you would like to add this feature. Ideally before creating a PR, create a new issue with, explain the reason, tag as `feature request` and tag maintainer eg. "saltyaom"
- It's recommended to add test cases to cover core feature of the feature you intent to add

#### Fixing Bug
- When opening an pull request fixing existing issue, please kindly include the issue link or id in the description
- Provide a detailed description of the bug in the PR. Live demo preferred.
- Add appropriate test coverage if applicable.
- It's OK to have multiple small commits as you work on the PR. GitHub can automatically squash them before merging.

## Thanks :purple_heart:

Thanks for all your contributions and efforts towards improving Elysia. We thank you for being part of our community :sparkles:!
