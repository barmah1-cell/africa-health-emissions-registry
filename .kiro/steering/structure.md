# Project Structure

```
src/
├── app.ts              # Express app setup (middleware, routes, error handler)
├── index.ts            # Server entry point (separated for testability)
├── lib/
│   └── prisma.ts       # Shared Prisma client instance
├── middleware/
│   ├── index.ts        # Barrel exports
│   ├── auth.ts         # JWT authentication (authenticate, optionalAuth)
│   ├── requireAdmin.ts # Admin role guard
│   ├── rateLimiter.ts  # IP-based rate limiting for auth failures
│   ├── errorHandler.ts # Centralized error handler (Zod, Prisma, SyntaxError mapping)
│   ├── asyncHandler.ts # Async route wrapper
│   └── validate.ts     # Request validation middleware
├── routes/
│   ├── index.ts        # Route registry (mounts all routers on /api/v1)
│   ├── facility.routes.ts
│   ├── geospatial.routes.ts
│   ├── bulk.routes.ts
│   ├── energy.routes.ts
│   ├── emissionFactor.routes.ts
│   └── audit.routes.ts
├── services/           # Business logic layer (one service per domain)
│   ├── facility.service.ts
│   ├── geospatial.service.ts
│   ├── energy.service.ts
│   ├── emissionFactor.service.ts
│   ├── audit.service.ts
│   ├── import.service.ts
│   └── export.service.ts
├── types/
│   ├── index.ts        # Barrel exports
│   ├── enums.ts        # Domain enums (FacilityType, EnergyType, etc.)
│   ├── models.ts       # Domain model interfaces
│   ├── api.ts          # API types (pagination, error codes, HTTP status mapping)
│   ├── countries.ts    # African countries list and validation
│   └── express.d.ts    # Express type augmentation (req.user)
├── utils/
│   ├── index.ts        # Barrel exports
│   ├── jwt.ts          # JWT sign/verify helpers
│   └── locale.ts       # Locale resolution logic
└── validation/
    ├── index.ts        # Barrel exports
    └── schemas.ts      # All Zod schemas and the validateInput helper

prisma/
├── schema.prisma       # Database schema (Facility, EnergySource, GhgEmission, etc.)
└── migrations/         # SQL migrations

tests/
├── integration/        # Full HTTP integration tests (supertest)
├── middleware/         # Middleware unit tests
├── properties/         # Property-based tests (fast-check)
├── routes/            # Route-level tests
├── services/          # Service-level tests
├── unit/              # Pure unit tests (auth, utils)
└── validation/        # Schema validation tests
```

## Architecture Patterns

- **Layered architecture**: Routes → Services → Prisma/Raw SQL
- **Service result pattern**: Services return `ServiceResponse<T>` (discriminated union of success/error) rather than throwing
- **Factory functions for routers**: Each route file exports a `createXRouter(prisma)` function receiving the Prisma client via dependency injection
- **Barrel exports**: Each module folder has an `index.ts` re-exporting public APIs
- **Separation of app and server**: `app.ts` is importable for testing without starting the HTTP server
- **Raw SQL for PostGIS**: Geolocation operations use `prisma.$queryRaw` because Prisma doesn't natively support geography types
- **Soft deletes**: Facilities use a `deletedAt` timestamp; all queries exclude soft-deleted records
- **Audit logging**: Mutations create audit entries capturing old/new values for changed fields
