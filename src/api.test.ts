/**
 * API tests on Node's built-in runner.
 *
 *   npm run build && npm test
 *
 * Each run uses a throwaway database file, set before ./db.js is imported.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';

const DB_FILE = join(tmpdir(), `job-tracker-test-${process.pid}.db`);
process.env.JOB_TRACKER_DB = DB_FILE;
process.env.NODE_ENV = 'test';

const { app } = await import('./server.js');
const store = await import('./db.js');

let server: Server;
let base: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('expected a TCP address');
  }
  base = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
  store.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(DB_FILE + suffix, { force: true });
  }
});

async function post(path: string, body: unknown) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown) {
  return fetch(base + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('customers', () => {
  it('creates and lists a customer', async () => {
    const created = await post('/api/customers', { name: 'Test GmbH' });
    assert.equal(created.status, 201);
    const customer = await created.json();
    assert.equal(customer.name, 'Test GmbH');

    const list = await (await fetch(base + '/api/customers')).json();
    assert.ok(list.some((row: { id: number }) => row.id === customer.id));
  });

  it('rejects a customer with no name', async () => {
    const response = await post('/api/customers', { name: '   ' });
    assert.equal(response.status, 400);
  });
});

describe('jobs', () => {
  let customerId: number;

  before(async () => {
    const response = await post('/api/customers', { name: 'Job Owner Ltd' });
    customerId = (await response.json()).id;
  });

  it('creates a job and returns the customer name with it', async () => {
    const response = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Build a thing',
      price_minor: 50000,
    });
    assert.equal(response.status, 201);
    const job = await response.json();
    assert.equal(job.customer_name, 'Job Owner Ltd');
    assert.equal(job.status, 'scheduled');
  });

  it('rejects a job for a customer that does not exist', async () => {
    const response = await post('/api/jobs', {
      customer_id: 999999,
      title: 'Orphan',
    });
    assert.equal(response.status, 400);
  });

  it('rejects an unknown status on create and on update', async () => {
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Status check',
      status: 'nonsense',
    });
    assert.equal(created.status, 400);

    const valid = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Status check 2',
    });
    const { id } = await valid.json();
    const updated = await patch(`/api/jobs/${id}`, { status: 'nonsense' });
    assert.equal(updated.status, 400);
  });

  it('ignores fields that are not in the update allow-list', async () => {
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Allow-list check',
    });
    const job = await created.json();

    // 'id' and 'created_at' are deliberately not updatable.
    const response = await patch(`/api/jobs/${job.id}`, {
      id: 4242,
      created_at: '1999-01-01',
      title: 'Renamed',
    });
    const after = await response.json();
    assert.equal(after.id, job.id);
    assert.equal(after.created_at, job.created_at);
    assert.equal(after.title, 'Renamed');
  });

  it('404s on updating or deleting a job that is not there', async () => {
    assert.equal((await patch('/api/jobs/987654', { title: 'x' })).status, 404);
    const deleted = await fetch(base + '/api/jobs/987654', { method: 'DELETE' });
    assert.equal(deleted.status, 404);
  });

  it('400s on a non-numeric id', async () => {
    const response = await patch('/api/jobs/abc', { title: 'x' });
    assert.equal(response.status, 400);
  });

  it('filters by status and searches by title', async () => {
    await post('/api/jobs', {
      customer_id: customerId,
      title: 'Findable unique title',
      status: 'blocked',
    });

    const blocked = await (await fetch(base + '/api/jobs?status=blocked')).json();
    assert.ok(blocked.every((job: { status: string }) => job.status === 'blocked'));

    const found = await (
      await fetch(base + '/api/jobs?q=Findable%20unique')
    ).json();
    assert.equal(found.length, 1);

    const bad = await fetch(base + '/api/jobs?status=not_a_status');
    assert.equal(bad.status, 400);
  });

  it('rejects a price that is not a number, instead of blowing up', async () => {
    // Number(undefined) is NaN and SQLite refuses to bind it. Without the
    // guard in the route this is a 500, not a 400.
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Bad price',
      price_minor: 'twelve euros',
    });
    assert.equal(created.status, 400);

    const negative = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Negative price',
      price_minor: -500,
    });
    assert.equal(negative.status, 400);
  });

  it('rejects moving a job to a customer that does not exist', async () => {
    // Without validation this violates the foreign key and surfaces as a 500.
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Reassignment check',
    });
    const { id } = await created.json();

    const response = await patch(`/api/jobs/${id}`, { customer_id: 999999 });
    assert.equal(response.status, 400);
  });

  it('rejects a blank title on update', async () => {
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Has a title',
    });
    const { id } = await created.json();

    const response = await patch(`/api/jobs/${id}`, { title: '   ' });
    assert.equal(response.status, 400);
  });

  it('deletes a job', async () => {
    const created = await post('/api/jobs', {
      customer_id: customerId,
      title: 'Short lived',
    });
    const { id } = await created.json();
    const deleted = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
  });
});

describe('reporting', () => {
  it('summarises value and counts by status', async () => {
    const summary = await (await fetch(base + '/api/summary')).json();
    assert.ok(typeof summary.openValueMinor === 'number');
    assert.ok(typeof summary.overdueCount === 'number');
    assert.ok(summary.byStatus);
  });

  it('exports CSV with a header and one row per job', async () => {
    const response = await fetch(base + '/export.csv');
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /text\/csv/,
    );
    const text = await response.text();
    const lines = text.trim().split('\n');
    assert.equal(lines[0], 'id,customer,title,status,scheduled_for,price,created_at');

    const jobs = await (await fetch(base + '/api/jobs')).json();
    assert.equal(lines.length - 1, jobs.length);
  });

  it('quotes CSV values that contain a comma', async () => {
    const customer = await (
      await post('/api/customers', { name: 'Comma, Inc' })
    ).json();
    await post('/api/jobs', {
      customer_id: customer.id,
      title: 'Nothing special',
    });

    const text = await (await fetch(base + '/export.csv')).text();
    assert.ok(text.includes('"Comma, Inc"'));
  });
});

describe('deleting a customer', () => {
  it('removes their jobs too', async () => {
    const customer = await (
      await post('/api/customers', { name: 'Cascade Test' })
    ).json();
    await post('/api/jobs', { customer_id: customer.id, title: 'Doomed' });

    const before = await (await fetch(base + '/api/jobs?q=Doomed')).json();
    assert.equal(before.length, 1);

    const deleted = await fetch(`${base}/api/customers/${customer.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleted.status, 204);

    const after = await (await fetch(base + '/api/jobs?q=Doomed')).json();
    assert.equal(after.length, 0);
  });
});
