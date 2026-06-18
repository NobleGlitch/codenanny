# @codenanny/plugkit

> Tiny plugin contract for modular Express apps.

`plugkit` is a ~150-line contract that lets you build modular Express applications where each module declares its own:

- Express router (mounted by the host)
- sqlite schema migrations (run automatically)
- Event bus subscriptions + emissions (shared across modules)
- Nav contribution (the host renders the combined nav)

It's the substrate that **[codenanny](https://github.com/desertshibari-crypto/codenanny)** is built on. But it's not codenanny-specific — use it for any modular Node app where you want clean module boundaries.

## Install

```bash
npm install @codenanny/plugkit
```

## Quickstart

```js
import express from 'express';
import Database from 'better-sqlite3';
import { createHost, defineModule } from '@codenanny/plugkit';

const app = express();
const db = new Database('app.db');
const host = createHost({ app, db });

// Define a module
const greeter = defineModule({
  name: 'greeter',
  mountPath: '/hello',
  schema: {
    migrations: [
      `CREATE TABLE IF NOT EXISTS greetings(id INTEGER PRIMARY KEY, who TEXT, ts INTEGER)`,
    ],
  },
  router: ({ db, events }) => {
    const r = express.Router();
    r.get('/:who', (req, res) => {
      db.prepare('INSERT INTO greetings(who, ts) VALUES (?, ?)').run(req.params.who, Date.now());
      events.emit('greeted', { who: req.params.who });
      res.send(`hi, ${req.params.who}`);
    });
    return r;
  },
  nav: { id: 'greeter', label: 'Greeter', route: '/hello/world' },
  subscribe: {
    'module:registered': ({ name }) => console.log(`module ${name} joined the host`),
  },
});

host.register(greeter);

app.get('/nav', (req, res) => res.json(host.getNav(req.user)));
app.listen(3000);
```

## Module shape

```js
defineModule({
  name: 'string (required, unique)',
  mountPath: '/optional/custom/path',          // defaults to `/<name>`
  schema: { migrations: ['CREATE TABLE ...'] },// run inside a transaction on register
  router: ({ db, events, logger, host }) => Router,
  subscribe: { 'event:name': (payload) => {} },// host's event bus
  nav: { id, label, icon?, route, roles? } | [...]
});
```

## Host shape

```js
const host = createHost({ app, db, logger });

host.register(mod);                  // register a module
host.getNav(user);                   // filtered/ordered nav for a user
host.getModule(name);                // retrieve a registered module
host.events.on('greeted', handler);  // listen on the shared event bus
host.events.emit('whatever', data);  // emit on the shared event bus
```

## Why this shape

- **Express router** because everyone knows Express; no new framework to learn.
- **sqlite migrations** because most small apps don't need anything more.
- **Event bus** so modules can react to each other without import cycles.
- **Nav contribution** so the host UI can render a coherent navrail without hardcoding what's where.

If you outgrow plugkit, you can replace it with anything that respects the same module shape.

## License

MIT. Created by [desertshibari-crypto](https://github.com/desertshibari-crypto).
