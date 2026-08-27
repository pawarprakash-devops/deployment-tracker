import { Pool } from 'pg';

// Check if we're in a development environment where Neon might not be accessible
const isDev = process.env.NODE_ENV === 'development';
const useMockData = isDev && process.env.USE_MOCK_DATA === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Reduced timeout for faster failure
});

export default pool;
export { useMockData };

export interface Environment {
  id: string;
  name: string;
  is_production: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface Deployment {
  id: string;
  environment: string;
  status: 'Success' | 'In Progress' | 'Failed' | 'Cancelled' | 'Rolled Back';
  branch?: string | null;
  version?: string | null;
  requested_by?: string | null;
  approved_by?: string | null;
  tested_by?: string | null;
  deployed_by?: string | null;
  ticket_link?: string | null;
  notes?: string | null;
  started_at: Date;
  completed_at?: Date | null;
  duration_seconds?: number | null;
  created_at: Date;
  updated_at: Date;
}
