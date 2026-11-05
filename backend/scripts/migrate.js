// Crea las tablas y, con --seed, carga los datos de ejemplo.
const { createDb } = require("../src/db/knex");
const { migrate } = require("../src/db/schema");
const { seed } = require("../src/db/seed");

(async () => {
  const db = createDb();
  try {
    await migrate(db);
    console.log("Tablas listas");
    if (process.argv.includes("--seed")) {
      console.log((await seed(db)) ? "Datos de ejemplo cargados" : "La base ya tenía datos; no se cargó nada");
    }
  } finally {
    await db.destroy();
  }
})();
