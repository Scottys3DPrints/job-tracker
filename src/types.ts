export const JOB_STATUSES = [
  'scheduled',
  'in_progress',
  'blocked',
  'done',
  'invoiced',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Job {
  id: number;
  customer_id: number;
  title: string;
  description: string | null;
  status: JobStatus;
  scheduled_for: string | null;
  price_minor: number;
  created_at: string;
  updated_at: string;
}

export interface JobWithCustomer extends Job {
  customer_name: string;
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string'
    && (JOB_STATUSES as readonly string[]).includes(value);
}
