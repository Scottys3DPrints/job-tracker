'use strict';

const COLUMNS = [
  { key: 'blocked', label: 'Blocked' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'done', label: 'Done' },
  { key: 'invoiced', label: 'Invoiced' },
];

const euro = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const state = { jobs: [], customers: [], editing: null };

const el = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showNotice(id, message) {
  const node = el(id);
  node.textContent = message;
  node.hidden = false;
}

function clearNotice(id) {
  el(id).hidden = true;
}

// ------------------------------------------------------------------ render

function renderFigures(summary) {
  const count = (key) => summary.byStatus[key]?.count ?? 0;
  const open = count('scheduled') + count('in_progress') + count('blocked');

  const figures = [
    { label: 'Open jobs', value: open },
    { label: 'Done, not invoiced', value: euro.format(summary.unbilledDoneMinor / 100), tone: 'good' },
    { label: 'Pipeline value', value: euro.format(summary.openValueMinor / 100) },
    { label: 'Past due', value: summary.overdueCount, tone: summary.overdueCount ? 'bad' : '' },
  ];

  el('figures').innerHTML = figures.map((figure) => `
    <div class="figure ${figure.tone ?? ''}">
      <div class="label">${figure.label}</div>
      <div class="value">${figure.value}</div>
    </div>`).join('');
}

function renderBoard() {
  const searching = el('search').value.trim().length > 0;

  if (state.jobs.length === 0) {
    el('board').innerHTML = '';
    el('empty').hidden = false;
    el('empty').innerHTML = searching
      ? 'No jobs match that search.'
      : (state.customers.length === 0
        ? 'No customers yet. Add one from <strong>Customers</strong>, then add your first job. Or run <code>npm run seed</code> for demo data.'
        : 'No jobs yet. Use <strong>Add job</strong> to create the first one.');
    return;
  }
  el('empty').hidden = true;

  el('board').innerHTML = COLUMNS.map((column) => {
    const jobs = state.jobs.filter((job) => job.status === column.key);
    const total = jobs.reduce((sum, job) => sum + job.price_minor, 0);

    const cards = jobs.map((job) => {
      const late = job.scheduled_for
        && job.scheduled_for < today()
        && !['done', 'invoiced'].includes(job.status);

      return `
        <button class="card" type="button" data-id="${job.id}">
          <span class="job">${escapeHtml(job.title)}</span>
          <span class="who">${escapeHtml(job.customer_name)}</span>
          <span class="line">
            <span class="due${late ? ' late' : ''}">${job.scheduled_for ? escapeHtml(job.scheduled_for) : 'no date'}</span>
            <span class="fee">${euro.format(job.price_minor / 100)}</span>
          </span>
        </button>`;
    }).join('');

    return `
      <section class="column ${column.key}">
        <div class="column-head">
          <span class="name">${column.label}</span>
          <span class="tally">${jobs.length}${total ? ' · ' + euro.format(total / 100) : ''}</span>
        </div>
        ${cards || '<p class="column-empty">—</p>'}
      </section>`;
  }).join('');
}

async function refresh() {
  const query = el('search').value.trim();
  const path = query ? `/api/jobs?q=${encodeURIComponent(query)}` : '/api/jobs';
  const [jobs, summary] = await Promise.all([api(path), api('/api/summary')]);
  state.jobs = jobs;
  renderFigures(summary);
  renderBoard();
}

async function reloadCustomers() {
  state.customers = await api('/api/customers');
}

// -------------------------------------------------------------- job dialog

function openJobDialog(job) {
  state.editing = job ?? null;
  clearNotice('job-error');

  el('job-dialog-eyebrow').textContent = job ? 'Record' : 'New record';
  el('job-dialog-title').textContent = job ? 'Edit job' : 'Add job';
  el('job-save').textContent = job ? 'Save changes' : 'Save job';
  el('delete-job').hidden = !job;

  el('customer-select').innerHTML = state.customers.length
    ? state.customers.map((customer) =>
      `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`).join('')
    : '<option value="">No customers yet</option>';

  el('customer-select').value = job ? job.customer_id : (state.customers[0]?.id ?? '');
  el('title').value = job?.title ?? '';
  el('description').value = job?.description ?? '';
  el('status').value = job?.status ?? 'scheduled';
  el('scheduled-for').value = job?.scheduled_for ?? '';
  el('price').value = job ? (job.price_minor / 100).toFixed(2) : '0';

  el('job-dialog').showModal();
  el('title').focus();
}

async function saveJob() {
  const customerId = Number(el('customer-select').value);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    showNotice('job-error', 'Add a customer first — open Customers and create one.');
    return;
  }

  const title = el('title').value.trim();
  if (!title) {
    showNotice('job-error', 'Give the job a name so you can find it later.');
    return;
  }

  const price = Number(el('price').value || 0);
  if (!Number.isFinite(price) || price < 0) {
    showNotice('job-error', 'Price must be 0 or more.');
    return;
  }

  const payload = {
    customer_id: customerId,
    title,
    description: el('description').value.trim() || null,
    status: el('status').value,
    scheduled_for: el('scheduled-for').value || null,
    // Round rather than truncate: 12.345 should not become 12.34.
    price_minor: Math.round(price * 100),
  };

  try {
    await api(
      state.editing ? `/api/jobs/${state.editing.id}` : '/api/jobs',
      {
        method: state.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  } catch (error) {
    showNotice('job-error', error.message);
    return;
  }

  el('job-dialog').close();
  await refresh();
}

async function deleteJob() {
  if (!state.editing) return;
  if (!confirm(`Delete "${state.editing.title}"? This cannot be undone.`)) return;

  try {
    await api(`/api/jobs/${state.editing.id}`, { method: 'DELETE' });
  } catch (error) {
    showNotice('job-error', error.message);
    return;
  }
  el('job-dialog').close();
  await refresh();
}

// --------------------------------------------------------- customer dialog

function jobsFor(customerId) {
  return state.jobs.filter((job) => job.customer_id === customerId).length;
}

function renderCustomers() {
  const list = el('customer-list');

  if (state.customers.length === 0) {
    list.innerHTML = '<li class="none">No customers yet. Add the first one below.</li>';
    return;
  }

  list.innerHTML = state.customers.map((customer) => {
    const contact = [customer.email, customer.phone].filter(Boolean).join(' · ');
    const count = jobsFor(customer.id);
    return `
      <li>
        <span class="who">
          <strong>${escapeHtml(customer.name)}</strong>
          ${contact ? `<small>${escapeHtml(contact)}</small>` : ''}
        </span>
        <span class="jobs">${count} job${count === 1 ? '' : 's'}</span>
        <button class="drop" type="button" data-id="${customer.id}"
                data-name="${escapeHtml(customer.name)}" data-jobs="${count}">Remove</button>
      </li>`;
  }).join('');
}

async function openCustomerDialog() {
  clearNotice('customer-error');
  await reloadCustomers();
  renderCustomers();
  el('customer-dialog').showModal();
  el('customer-name').focus();
}

async function addCustomer() {
  const name = el('customer-name').value.trim();
  if (!name) {
    showNotice('customer-error', 'A customer needs a name.');
    return;
  }

  try {
    await api('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: el('customer-email').value.trim() || null,
        phone: el('customer-phone').value.trim() || null,
      }),
    });
  } catch (error) {
    showNotice('customer-error', error.message);
    return;
  }

  el('customer-name').value = '';
  el('customer-email').value = '';
  el('customer-phone').value = '';
  clearNotice('customer-error');

  await reloadCustomers();
  renderCustomers();
  el('customer-name').focus();
}

async function removeCustomer(id, name, jobCount) {
  const warning = jobCount > 0
    ? `Remove ${name} and their ${jobCount} job${jobCount === 1 ? '' : 's'}? This cannot be undone.`
    : `Remove ${name}? This cannot be undone.`;
  if (!confirm(warning)) return;

  try {
    await api(`/api/customers/${id}`, { method: 'DELETE' });
  } catch (error) {
    showNotice('customer-error', error.message);
    return;
  }

  await reloadCustomers();
  await refresh();
  renderCustomers();
}

// ------------------------------------------------------------------ wiring

el('new-job').addEventListener('click', () => openJobDialog(null));
el('job-save').addEventListener('click', saveJob);
el('delete-job').addEventListener('click', deleteJob);
el('job-cancel').addEventListener('click', () => el('job-dialog').close());

el('open-customers').addEventListener('click', openCustomerDialog);
el('customer-add').addEventListener('click', addCustomer);
el('customer-close').addEventListener('click', () => el('customer-dialog').close());

el('customer-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); addCustomer(); }
});

el('customer-list').addEventListener('click', (event) => {
  const button = event.target.closest('.drop');
  if (!button) return;
  removeCustomer(
    Number(button.dataset.id),
    button.dataset.name,
    Number(button.dataset.jobs),
  );
});

el('board').addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (!card) return;
  openJobDialog(state.jobs.find((job) => job.id === Number(card.dataset.id)));
});

let searchTimer;
el('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    refresh().catch((error) => showNotice('job-error', error.message));
  }, 200);
});

(async function start() {
  try {
    await reloadCustomers();
    await refresh();
  } catch (error) {
    el('empty').hidden = false;
    el('empty').textContent = `Could not reach the server: ${error.message}`;
  }
})();
