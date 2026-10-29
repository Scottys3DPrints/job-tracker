/**
 * Load a realistic demo dataset so a fresh clone isn't an empty screen.
 *
 *   npm run build && npm run seed
 */

import { db, createCustomer, createJob } from './db.js';
import type { JobStatus } from './types.js';

const existing = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as {
  n: number;
};

if (existing.n > 0) {
  console.log(`${existing.n} customers already present; not seeding again.`);
  process.exit(0);
}

const CUSTOMERS = [
  { name: 'Hafen Bäckerei GmbH', email: 'buero@hafenbaeckerei.example', phone: '+49 40 1234567' },
  { name: 'Altona Dental Practice', email: 'reception@altona-dental.example', phone: '+49 40 2345678' },
  { name: 'Nordlicht Café', email: 'hallo@nordlicht.example', phone: '+49 40 3456789' },
  { name: 'Elbe Fitness Studio', email: 'info@elbefitness.example', phone: '+49 40 4567890' },
  { name: 'Schmidt & Söhne Logistik', email: 'disposition@schmidt-logistik.example', phone: '+49 40 5678901' },
];

function daysFromNow(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const JOBS: {
  customer: string;
  title: string;
  description: string;
  status: JobStatus;
  day: number;
  price: number;
}[] = [
  { customer: 'Hafen Bäckerei GmbH', title: 'Online ordering page', description: 'Single-page order form, orders land in a shared inbox and a Google Sheet.', status: 'in_progress', day: 4, price: 180000 },
  { customer: 'Hafen Bäckerei GmbH', title: 'Daily stock report automation', description: 'Pull till export each night, email a one-page summary at 06:00.', status: 'scheduled', day: 11, price: 65000 },
  { customer: 'Altona Dental Practice', title: 'Appointment reminder SMS', description: 'Read tomorrow\'s bookings, send reminders, log replies.', status: 'done', day: -6, price: 94000 },
  { customer: 'Altona Dental Practice', title: 'Patient intake form', description: 'Replace the paper form; export to their practice software as CSV.', status: 'blocked', day: -2, price: 120000 },
  { customer: 'Nordlicht Café', title: 'Supplier price monitor', description: 'Track four wholesaler sites, alert on any increase above 3%.', status: 'invoiced', day: -19, price: 72000 },
  { customer: 'Nordlicht Café', title: 'Weekly rota generator', description: 'Build the staff rota from availability, export to PDF.', status: 'scheduled', day: 18, price: 88000 },
  { customer: 'Elbe Fitness Studio', title: 'Membership churn dashboard', description: 'Daily sync from their billing system, flag lapsed members.', status: 'in_progress', day: 2, price: 230000 },
  { customer: 'Elbe Fitness Studio', title: 'Class booking widget', description: 'Embeddable booking widget for the existing WordPress site.', status: 'done', day: -4, price: 156000 },
  { customer: 'Schmidt & Söhne Logistik', title: 'Delivery note OCR', description: 'Scan signed delivery notes, extract reference numbers into the ERP.', status: 'blocked', day: -9, price: 340000 },
  { customer: 'Schmidt & Söhne Logistik', title: 'Driver shift export', description: 'Nightly export of driver hours to the payroll provider.', status: 'invoiced', day: -27, price: 110000 },
  { customer: 'Schmidt & Söhne Logistik', title: 'Fuel card reconciliation', description: 'Match fuel card statements against trip records, flag mismatches.', status: 'scheduled', day: 7, price: 145000 },
  { customer: 'Nordlicht Café', title: 'Google review auto-reply drafts', description: 'Draft replies to new reviews for the owner to approve.', status: 'done', day: -1, price: 48000 },
];

const ids = new Map<string, number>();
for (const customer of CUSTOMERS) {
  ids.set(customer.name, createCustomer(customer).id);
}

for (const job of JOBS) {
  createJob({
    customer_id: ids.get(job.customer)!,
    title: job.title,
    description: job.description,
    status: job.status,
    scheduled_for: daysFromNow(job.day),
    price_minor: job.price,
  });
}

console.log(`Seeded ${CUSTOMERS.length} customers and ${JOBS.length} jobs.`);
