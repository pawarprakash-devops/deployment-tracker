# Deployment Tracker

A real-time deployment tracking system built with Next.js 16, Neon Postgres, and Tailwind CSS.

## Features

✅ **Real-time Updates** - Auto-refreshes every 5 seconds  
✅ **Neon Postgres Database** - Serverless, scalable database  
✅ **REST API** - Full CRUD operations for deployments  
✅ **Environment Management** - Track multiple environments  
✅ **Modern UI** - Built with Tailwind CSS  

## Database Schema

### Tables

**environments**
- `id` (UUID)
- `name` (TEXT, unique)
- `is_production` (BOOLEAN)
- `display_order` (INTEGER)
- `created_at`, `updated_at` (TIMESTAMP)

**deployments**
- `id` (UUID)
- `environment` (TEXT)
- `status` (Success | In Progress | Failed | Cancelled | Rolled Back)
- `branch`, `version`, `requested_by`, `approved_by`, `tested_by`, `deployed_by`, `ticket_link`, `notes` (TEXT, optional)
- `started_at`, `completed_at` (TIMESTAMP)
- `duration_seconds` (INTEGER, optional)
- `created_at`, `updated_at` (TIMESTAMP)

## Setup

### 1. Environment Variables

Already configured in `.env.local`:
```
DATABASE_URL=postgresql://neondb_owner:***@ep-bitter-glade-axhroi23-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database

Database schema is already created with these tables:
- `environments` (with 6 default environments: QA, Stage, Preview, Pre-Prod, Pre-Prod USW, Production)
- `deployments`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## API Endpoints

### Deployments

- `GET /api/deployments` - List all deployments (last 100)
- `POST /api/deployments` - Create new deployment
- `PATCH /api/deployments/[id]` - Update deployment
- `DELETE /api/deployments/[id]` - Delete deployment

### Environments

- `GET /api/environments` - List all environments
- `POST /api/environments` - Create new environment

## Deploy to Vercel

### Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/deployment-tracker)

### Manual Deploy

1. Push this code to GitHub
2. Go to [Vercel](https://vercel.com)
3. Import your repository
4. Add environment variable:
   - `DATABASE_URL` = your Neon connection string
5. Deploy!

### Environment Variables in Vercel

Go to Project Settings → Environment Variables and add:

```
DATABASE_URL=postgresql://neondb_owner:npg_yDVnf1w5IkOt@ep-bitter-glade-axhroi23-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

## Project Structure

```
deployment-tracker/
├── app/
│   ├── api/
│   │   ├── deployments/
│   │   │   ├── route.ts          # GET, POST deployments
│   │   │   └── [id]/route.ts     # PATCH, DELETE deployment
│   │   └── environments/
│   │       └── route.ts          # GET, POST environments
│   ├── layout.tsx
│   └── page.tsx                  # Main UI
├── lib/
│   └── db.ts                     # Database connection & types
├── .env.local                    # Environment variables (DO NOT COMMIT)
├── package.json
└── README.md
```

## Neon Project Details

- **Project Name:** deployment-tracker
- **Project ID:** divine-breeze-16420695
- **Organization:** Prakash (org-proud-firefly-79937291)
- **Region:** us-east-2 (Ohio)
- **Database:** neondb
- **Connection:** Pooled connection (recommended for serverless)

## Development

### Add a Test Deployment

You can add a test deployment via the UI or via API:

```bash
curl -X POST http://localhost:3000/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "QA",
    "status": "Success",
    "branch": "main",
    "version": "v1.0.0",
    "requested_by": "prakash",
    "started_at": "2026-08-27T10:00:00"
  }'
```

### Query the Database Directly

```bash
psql "postgresql://neondb_owner:npg_yDVnf1w5IkOt@ep-bitter-glade-axhroi23-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require" -c "SELECT * FROM deployments ORDER BY started_at DESC LIMIT 10;"
```

## Next Steps

1. **Deploy to Vercel** - Push to GitHub and deploy
2. **Add Authentication** - Implement auth for write operations
3. **GitHub Actions Integration** - Auto-log deployments from CI/CD
4. **WebSocket Support** - Replace polling with real-time WebSocket updates
5. **Export/Import** - Add JSON export/import functionality

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Neon Postgres (Serverless)
- **Styling:** Tailwind CSS
- **Language:** TypeScript
- **Deployment:** Vercel (recommended)

## License

MIT
