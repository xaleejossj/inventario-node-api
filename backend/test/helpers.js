const request = require("supertest");
const { createDb } = require("../src/db/knex");
const { migrate } = require("../src/db/schema");
const { seed } = require("../src/db/seed");
const { createApp } = require("../src/app");

/** Levanta la app sobre una base SQLite en memoria con los datos de ejemplo. */
async function setup() {
  const db = createDb({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migrate(db);
  await seed(db);
  const { app } = createApp(db);
  const api = request(app);

  const tokens = {};
  for (const [role, email] of Object.entries({ admin: "admin@bodega.co", operator: "operador@bodega.co", viewer: "consulta@bodega.co" })) {
    const res = await api.post("/api/auth/login").send({ email, password: "Demo1234*" });
    tokens[role] = res.body.token;
  }
  const as = (role) => ({
    get: (url) => api.get(url).set("Authorization", `Bearer ${tokens[role]}`),
    post: (url, body) => api.post(url).set("Authorization", `Bearer ${tokens[role]}`).send(body),
    patch: (url, body) => api.patch(url).set("Authorization", `Bearer ${tokens[role]}`).send(body),
    delete: (url) => api.delete(url).set("Authorization", `Bearer ${tokens[role]}`),
  });
  return { db, api, as };
}

module.exports = { setup };
