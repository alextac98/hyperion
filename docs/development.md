# Development

Hyperion currently runs as a local browser application. It does not include a
hosting target, server runtime, user system, or remote database.

## Requirements

- Node.js 22.13 or newer
- npm

## Getting started

Install the dependencies and start the development server:

```sh
npm install
npm run dev
```

## Project commands

- `npm run build` type-checks the project and creates a production build.
- `npm run lint` checks the code with ESLint.
- `npm test` builds the application and validates its static output.
- `npm run preview` serves the production build locally.
