const knex = require("knex");
const config = require("../config");

/** Crea una conexión. Las pruebas pasan su propia configuración (SQLite en memoria). */
function createDb(dbConfig = config.db) {
  const db = knex(dbConfig);
  if (dbConfig.client === "better-sqlite3") {
    // SQLite no aplica llaves foráneas por defecto.
    db.client.pool.on("createSuccess", (_eventId, resource) => {
      resource.pragma("foreign_keys = ON");
    });
  }
  return db;
}

module.exports = { createDb };
