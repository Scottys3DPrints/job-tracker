import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as store from './db.js';
import { isJobStatus } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const PORT = Number(process.env.PORT ?? 3000);

export const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

/** Parse an :id path param, or send 400 and return null. */
function parseId(value: string, res: express.Response): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'id must be a positive integer' });
    return null;
  }
  return id;
}

/**
 * Validate a money field. `Number(undefined)` is NaN and SQLite refuses to
 * bind it, which would otherwise surface as a 500 on a typo'd price.
 */
function parsePriceMinor(
  value: unknown,
  res: express.Response,
): number | null {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: 'price_minor must be a number of 0 or more' });
    return null;
  }
  return Math.round(amount);
}

/** Check a customer exists before we hand the id to a foreign key. */
function requireCustomer(value: unknown, res: express.Response): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || !store.getCustomer(id)) {
    res.status(400).json({ error: 'customer_id must reference a customer' });
    return null;
  }
  return id;
}

// ---------------------------------------------------------------- customers

app.get('/api/customers', (_req, res) => {
  res.json(store.listCustomers());
});

app.post('/api/customers', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (name.length > 120) {
    res.status(400).json({ error: 'name must be 120 characters or fewer' });
    return;
  }
  res.status(201).json(
    store.createCustomer({
      name,
      email: req.body?.email?.trim() || null,
      phone: req.body?.phone?.trim() || null,
      notes: req.body?.notes?.trim() || null,
    }),
  );
});

app.delete('/api/customers/:id', (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (!store.deleteCustomer(id)) {
    res.status(404).json({ error: 'customer not found' });
    return;
  }
  res.status(204).end();
});

// --------------------------------------------------------------------- jobs

app.get('/api/jobs', (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !isJobStatus(status)) {
    res.status(400).json({ error: `unknown status ${String(status)}` });
    return;
  }
  res.json(
    store.listJobs({
      status: status as never,
      q: req.query.q ? String(req.query.q) : undefined,
    }),
  );
});

app.post('/api/jobs', (req, res) => {
  const customerId = requireCustomer(req.body?.customer_id, res);
  if (customerId === null) return;

  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (req.body?.status !== undefined && !isJobStatus(req.body.status)) {
    res.status(400).json({ error: `unknown status ${req.body.status}` });
    return;
  }

  const priceMinor = parsePriceMinor(req.body?.price_minor, res);
  if (priceMinor === null) return;

  res.status(201).json(
    store.createJob({
      customer_id: customerId,
      title,
      description: req.body?.description ?? null,
      status: req.body?.status,
      scheduled_for: req.body?.scheduled_for || null,
      price_minor: priceMinor,
    }),
  );
});

app.patch('/api/jobs/:id', (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const patch: Record<string, unknown> = { ...(req.body ?? {}) };

  if (patch.status !== undefined && !isJobStatus(patch.status)) {
    res.status(400).json({ error: `unknown status ${patch.status}` });
    return;
  }

  // Moving a job to another customer must not be allowed to violate the
  // foreign key -- that would come back as a 500 rather than a useful error.
  if (patch.customer_id !== undefined) {
    const customerId = requireCustomer(patch.customer_id, res);
    if (customerId === null) return;
    patch.customer_id = customerId;
  }

  if (patch.price_minor !== undefined) {
    const priceMinor = parsePriceMinor(patch.price_minor, res);
    if (priceMinor === null) return;
    patch.price_minor = priceMinor;
  }

  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) {
      res.status(400).json({ error: 'title cannot be blank' });
      return;
    }
    patch.title = title;
  }

  const updated = store.updateJob(id, patch);
  if (!updated) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/jobs/:id', (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (!store.deleteJob(id)) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.status(204).end();
});

// ------------------------------------------------------------ reporting /io

app.get('/api/summary', (_req, res) => {
  res.json(store.summary());
});

app.get('/export.csv', (_req, res) => {
  const rows = store.allJobsForExport();
  const header = [
    'id', 'customer', 'title', 'status', 'scheduled_for', 'price', 'created_at',
  ];

  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      row.id,
      row.customer_name,
      row.title,
      row.status,
      row.scheduled_for ?? '',
      (row.price_minor / 100).toFixed(2),
      row.created_at,
    ].map(escape).join(','));
  }

  res.type('text/csv')
    .set('Content-Disposition', 'attachment; filename="jobs.csv"')
    .send(lines.join('\n'));
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', ...store.summary() });
});

// Anything that still throws becomes a clean 500 with a logged cause, rather
// than Express's default HTML stack trace leaking into a client's browser.
app.use((
  error: Error,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  console.error('unhandled error:', error);
  res.status(500).json({ error: 'something went wrong on our side' });
});

// Started directly (not imported by a test).
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Job tracker listening on http://127.0.0.1:${PORT}`);
  });
}
