# Tech Stack

## Runtime & Language
- **Node.js** with **TypeScript** (ES2022 target, strict mode, CommonJS modules)
- Entry point: `src/index.ts` (server start), `src/app.ts` (Express app config)

## Frameworks & Libraries
- **Express** — HTTP server and routing
- **Prisma** (v5) — ORM and database client (with raw SQL for PostGIS operations)
- **PostgreSQL** with **PostGIS** extension — geospatial data storage
- **Zod** — Runtime input validation (safeParse for collecting all errors)
- **jsonwebtoken** — JWT-based authentication
- **PapaParse** — CSV parsing for bulk import/export

## Testing
- **Vitest** — Test runner (globals enabled, node environment)
- **fast-check** — Property-based testing
- **supertest** — HTTP integration tests

## Build & Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run dev` | Run in development mode (`ts-node src/index.ts`) |
| `npm start` | Run compiled output (`node dist/index.js`) |
| `npm test` | Run all tests once (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with V8 coverage |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:studio` | Open Prisma Studio GUI |

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (PostGIS required)
- `JWT_SECRET` — Secret for signing JWTs
- `PORT` — Server port (default 3000)
- `NODE_ENV` — Environment mode

## TypeScript Configuration
- Strict mode enabled
- Path alias: `@/*` → `src/*`
- Output: `dist/` directory
- Source maps and declaration files generated
