# feVttrpgBE

Fastify + PostgreSQL + Redis + Socket.io backend for the FeVTTRPG MVP.

## Stack
- Fastify + TypeScript
- Prisma + PostgreSQL
- Redis-backed sessions
- Socket.io realtime token updates

## Requirements
- Node.js 18+ (20+ recommended)
- PostgreSQL
- Redis

## Environment

Create a `.env` file in this repo with:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public"
REDIS_URL="redis://HOST:PORT"
SESSION_SECRET="replace-me"
# Optional
PORT=4000
CORS_ORIGIN="http://localhost:5173"
```

## Setup
1. Install dependencies: `npm install`
2. Run migrations: `npm run prisma:migrate`
3. (Optional) Seed data: `npm run seed`
	- The seed script expects `classData.json`, `itemData.js`, `skillData.js`, and `characterData.json` to exist in the workspace root.
	- It also expects at least one user account to exist before seeding characters.
4. Start dev server: `npm run dev`

## Scripts
- `npm run dev` — Start dev server (tsx watch)
- `npm run build` — Build TypeScript
- `npm run start` — Start server with tsx
- `npm run start:prod` — Start compiled build
- `npm run prisma:migrate` — Run Prisma migrations
- `npm run prisma:generate` — Generate Prisma client
- `npm run seed` — Seed classes/items/skills/characters

## API
All routes are prefixed with `/api`.

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Campaigns
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:campaignId/role`
- `GET /api/campaigns/:campaignId/members`

### Characters
- `GET /api/campaigns/:campaignId/characters`
- `POST /api/campaigns/:campaignId/characters`

### Classes
- `GET /api/classes`

### Maps & Tokens
- `GET /api/campaigns/:campaignId/maps`
- `POST /api/campaigns/:campaignId/maps`
- `GET /api/maps/:mapId`
- `GET /api/maps/:mapId/tokens`
- `POST /api/maps/:mapId/tokens`

## Realtime
Socket.io is hosted on the same server as the API.

Events:
- Client → Server: `map:join` `{ mapId }`
- Client → Server: `token:move` `{ mapId, tokenId, x, y }`
- Server → Client: `token:moved` `{ token }`
