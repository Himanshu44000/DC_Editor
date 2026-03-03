# hm

Production-ready Node.js + Express starter with common defaults.

## Features

- Express API with structured app/server split
- Security + DX middleware (`helmet`, `cors`, `morgan`)
- Env loading via `dotenv`
- Centralized 404 + error handlers
- ESLint + Prettier setup
- Variant: `TypeScript`

## Quick Start

1. Install dependencies

   ```bash
   npm install
   ```

2. Create environment file

   ```bash
   cp .env.example .env
   ```

3. Start development server

   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev`: start dev server
- `npm run start`: start production server
- `npm run lint`: run ESLint
- `npm run lint:fix`: fix lint issues
- `npm run format`: format with Prettier
- `npm run format:check`: check formatting
- `npm run build`: compile TypeScript to dist
- `npm run typecheck`: run TypeScript checks

## Endpoints

- `GET /health`: API health check
- `GET /api`: API welcome response
