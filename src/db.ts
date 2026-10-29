import Database from 'better-sqlite3';
import type { Customer, Job, JobStatus, JobWithCustomer } from './types.js';

const DB_PATH = process.env.JOB_TRACKER_DB ?? 'job_tracker.db';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY,
    customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_for TEXT,
    price_minor   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
`);

// ---------------------------------------------------------------- customers

export function listCustomers(): Customer[] {
  return db.prepare('SELECT * FROM customers ORDER BY name').all() as Customer[];
}

export function getCustomer(id: number): Customer | undefined {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | Customer
    | undefined;
}

export function createCustomer(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}): Customer {
  const result = db
    .prepare(
      'INSERT INTO customers (name, email, phone, notes) VALUES (?, ?, ?, ?)',
    )
    .run(
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.notes ?? null,
    );
  return getCustomer(Number(result.lastInsertRowid))!;
}

export function deleteCustomer(id: number): boolean {
  // ON DELETE CASCADE removes the customer's jobs with them.
  return db.prepare('DELETE FROM customers WHERE id = ?').run(id).changes > 0;
}

// --------------------------------------------------------------------- jobs

const JOB_SELECT = `
  SELECT j.*, c.name AS customer_name
  FROM jobs j JOIN customers c ON c.id = j.customer_id
`;

export function listJobs(filter: { status?: JobStatus; q?: string } = {}):
  JobWithCustomer[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    clauses.push('j.status = ?');
    params.push(filter.status);
  }
  if (filter.q) {
    clauses.push('(j.title LIKE ? OR c.name LIKE ?)');
    const like = `%${filter.q}%`;
    params.push(like, like);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const sql = `${JOB_SELECT}${where} ORDER BY
    CASE j.status
      WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'scheduled' THEN 2
      WHEN 'done' THEN 3 ELSE 4 END,
    COALESCE(j.scheduled_for, '9999'), j.id`;

  return db.prepare(sql).all(...params) as JobWithCustomer[];
}

export function getJob(id: number): JobWithCustomer | undefined {
  return db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as
    | JobWithCustomer
    | undefined;
}

export function createJob(input: {
  customer_id: number;
  title: string;
  description?: string | null;
  status?: JobStatus;
  scheduled_for?: string | null;
  price_minor?: number;
}): JobWithCustomer {
  const result = db
    .prepare(
      `INSERT INTO jobs (customer_id, title, description, status,
                         scheduled_for, price_minor)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.customer_id,
      input.title,
      input.description ?? null,
      input.status ?? 'scheduled',
      input.scheduled_for ?? null,
      input.price_minor ?? 0,
    );
  return getJob(Number(result.lastInsertRowid))!;
}

const UPDATABLE = [
  'customer_id',
  'title',
  'description',
  'status',
  'scheduled_for',
  'price_minor',
] as const;

export function updateJob(
  id: number,
  patch: Partial<Record<(typeof UPDATABLE)[number], unknown>>,
): JobWithCustomer | undefined {
  // Only ever interpolate column names from the allow-list above; values are
  // always bound. This is the one place a tracker like this grows an
  // injection hole.
  const fields = UPDATABLE.filter((key) => patch[key] !== undefined);
  if (fields.length === 0) return getJob(id);

  const assignments = fields.map((key) => `${key} = ?`).join(', ');
  const values = fields.map((key) => patch[key]);

  const result = db
    .prepare(
      `UPDATE jobs SET ${assignments}, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(...values, id);

  return result.changes > 0 ? getJob(id) : undefined;
}

export function deleteJob(id: number): boolean {
  return db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0;
}

// ------------------------------------------------------------------ reports

export interface Summary {
  byStatus: Record<string, { count: number; value_minor: number }>;
  openValueMinor: number;
  unbilledDoneMinor: number;
  overdueCount: number;
}

export function summary(): Summary {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(price_minor), 0) AS value
       FROM jobs GROUP BY status`,
    )
    .all() as { status: string; count: number; value: number }[];

  const byStatus: Summary['byStatus'] = {};
  for (const row of rows) {
    byStatus[row.status] = { count: row.count, value_minor: row.value };
  }

  const openValue = rows
    .filter((row) => row.status !== 'invoiced')
    .reduce((total, row) => total + row.value, 0);

  // Work finished but not yet billed -- the number an owner cares about most.
  const unbilled = byStatus['done']?.value_minor ?? 0;

  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE scheduled_for IS NOT NULL
         AND scheduled_for < date('now')
         AND status IN ('scheduled', 'in_progress', 'blocked')`,
    )
    .get() as { n: number };

  return {
    byStatus,
    openValueMinor: openValue,
    unbilledDoneMinor: unbilled,
    overdueCount: overdue.n,
  };
}

export function allJobsForExport(): (Job & { customer_name: string })[] {
  return db
    .prepare(`${JOB_SELECT} ORDER BY j.id`)
    .all() as (Job & { customer_name: string })[];
}
