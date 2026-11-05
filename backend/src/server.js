const config = require("./config");
const { createDb } = require("./db/knex");
const { migrate } = require("./db/schema");
const { seed } = require("./db/seed");
const { createApp } = require("./app");

async function main() {
  const db = createDb();
  await migrate(db);
  if (process.env.SEED_DATA !== "false") {
    await seed(db);
  }
  const { app } = createApp(db);
  const server = app.listen(config.port, () => {
    console.log(`Bodega API escuchando en http://localhost:${config.port} (docs en /docs)`);
  });

  const shutdown = () => server.close(() => db.destroy().then(() => process.exit(0)));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("No se pudo iniciar la API:", err);
  process.exit(1);
});
