# Upwork portfolio item — copy/paste

**Project title**

```
Service Job Tracker — internal tool replacing a spreadsheet
```

**Description** (~570 characters)

```
An internal job-tracking tool for a small service business: customers, jobs, a status board, and the two numbers an owner checks every morning — what's past due and what's been done but not yet invoiced.

TypeScript, Express and SQLite on the back end. The front end is plain HTML, CSS and JavaScript with no framework, so there's nothing to upgrade in a year and any developer can change it later.

Money is stored as integer cents, updates run through an explicit column allow-list, and every value is validated before it reaches the database — a bad price or a missing customer gets a clear 400, never a 500. 17 passing API tests. Everything exports to CSV, so the client is never locked in.
```

**Skills to tag**

TypeScript, JavaScript, Node.js, Web Development, Web Application, SQL, API Development

**Image to upload**

`screenshots/board.jpg` (primary), then `screenshots/edit-dialog.jpg` and
`screenshots/customers.jpg`.

**Project URL**

Your GitHub repo link, once pushed.

---

## Talking points if a client asks about it on a call

- *"Can it handle our workflow?"* — The statuses are a one-line change. The
  board renders whatever you define.
- *"What about our existing spreadsheet?"* — Import is a short script; CSV
  export already works, so you can always get back out.
- *"Multiple users?"* — SQLite handles a small team on one box. When you
  outgrow it the queries move to Postgres essentially unchanged; that's why
  the data access sits in one file.
- *"Why no React?"* — For a tool this size a framework is cost without
  benefit: a build step, a dependency tree, and an upgrade treadmill. This
  loads instantly and anyone can edit it.
- *"Can we add invoicing / photos / scheduling?"* — Yes, each is a contained
  addition. Show them `src/db.ts` and the route file; the shape is obvious.
