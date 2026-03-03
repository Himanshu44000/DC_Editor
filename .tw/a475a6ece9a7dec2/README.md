# m

Production-ready Node.js + Express starter with common defaults.

## Features

- Express API with structured app/server split
- Security + DX middleware (`helmet`, `cors`, `morgan`)
- Env loading via `dotenv`
- Centralized 404 + error handlers
- Hot reload via `nodemon`
- ESLint + Prettier setup

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

- `npm run dev`: start with nodemon
- `npm run start`: start with Node.js
- `npm run lint`: run ESLint
- `npm run lint:fix`: fix lint issues
- `npm run format`: format with Prettier
- `npm run format:check`: check formatting

## Endpoints

- `GET /health`: API health check
- `GET /api`: API welcome response
