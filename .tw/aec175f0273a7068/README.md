# 1st

Production-ready Node.js + TypeScript starter optimized for VS Code workflows.

## Requirements

- Node.js 20+

## Quick Start

1. Install dependencies

   ```bash
   npm install
   ```

2. Create environment file

   ```bash
   cp .env.example .env
   ```

3. Run in development mode

   ```bash
   npm run dev
   ```

4. Open in browser

   - http://localhost:3000/
   - http://localhost:3000/health

## Scripts

- `npm run dev` start watch mode with tsx
- `npm run build` compile TypeScript to dist
- `npm run typecheck` run TypeScript checks
- `npm start` run compiled app from dist

## VS Code

- Press `F5` and choose one of:
  - `Debug TypeScript (tsx)` for direct TS debugging
  - `Debug built app` to debug compiled output with source maps
