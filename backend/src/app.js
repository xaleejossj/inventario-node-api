const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");
const config = require("./config");
const { AppError } = require("./errors");
const { buildRouter } = require("./routes");
const { createCatalogService } = require("./services/catalogService");
const { createInventoryService } = require("./services/inventoryService");
const { createDashboardService } = require("./services/dashboardService");

/** Construye la aplicación Express. Recibe la conexión para poder probarla con SQLite en memoria. */
function createApp(db) {
  const catalog = createCatalogService(db);
  const inventory = createInventoryService(db);
  const dashboard = createDashboardService(db, catalog);

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "100kb" }));

  const openapi = YAML.parse(fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Bodega API" }));
  app.get("/openapi.json", (_req, res) => res.json(openapi));

  app.get("/health", async (_req, res) => {
    await db.raw("select 1");
    res.json({ status: "ok" });
  });

  app.use("/api", buildRouter({ db, catalog, inventory, dashboard }));

  app.use((_req, _res, next) => next(new AppError(404, "No encontrado", "La ruta no existe")));

  // Manejador central: respuestas con formato RFC 7807 (problem+json).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err instanceof AppError ? err.status : err.type === "entity.parse.failed" ? 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).type("application/problem+json").json({
      status,
      title: err instanceof AppError ? err.title : status === 400 ? "JSON inválido" : "Error interno",
      detail: status === 500 ? "Ocurrió un error inesperado" : err.message,
      ...(err.extra || {}),
    });
  });

  return { app, services: { catalog, inventory, dashboard } };
}

module.exports = { createApp };
