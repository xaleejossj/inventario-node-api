const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { authenticate, authorize, signToken } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { AppError } = require("../errors");
const S = require("./schemas");

/** Envuelve un handler async para que sus errores lleguen al manejador central. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function buildRouter({ db, catalog, inventory, dashboard }) {
  const r = express.Router();
  const canWrite = authorize("ADMIN", "OPERATOR");

  // ---------------------------------------------------------------- auth
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

  r.post("/auth/login", loginLimiter, validate(S.login), h(async (req, res) => {
    const user = await db("users").whereRaw("lower(email) = ?", [req.body.email.toLowerCase()]).first();
    const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
    if (!ok) throw new AppError(401, "Credenciales inválidas", "Correo o contraseña incorrectos");
    res.json({
      token: signToken(user),
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role },
    });
  }));

  r.use(authenticate);

  r.get("/me", (req, res) => res.json(req.user));

  // ---------------------------------------------------------------- catálogo
  r.get("/products", validate(S.productQuery, "query"), h(async (req, res) => {
    res.json(await catalog.listProducts(req.validQuery));
  }));

  r.get("/products/export.csv", h(async (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="inventario.csv"');
    res.send(await catalog.exportCsv());
  }));

  r.get("/products/:id", validate(S.idParam, "params"), h(async (req, res) => {
    res.json(await catalog.getProduct(req.params.id));
  }));

  r.get("/products/:id/history", validate(S.idParam, "params"), h(async (req, res) => {
    res.json(await catalog.productHistory(req.params.id));
  }));

  r.get("/products/:id/kardex", validate(S.idParam, "params"), validate(S.kardexQuery, "query"), h(async (req, res) => {
    res.json(await inventory.kardex(req.params.id, req.validQuery.warehouseId));
  }));

  r.post("/products", canWrite, validate(S.productCreate), h(async (req, res) => {
    res.status(201).json(await catalog.createProduct(req.user.id, req.body));
  }));

  r.patch("/products/:id", canWrite, validate(S.idParam, "params"), validate(S.productUpdate), h(async (req, res) => {
    res.json(await catalog.updateProduct(req.user.id, req.params.id, req.body));
  }));

  r.delete("/products/:id", authorize("ADMIN"), validate(S.idParam, "params"), h(async (req, res) => {
    res.json(await catalog.deactivateProduct(req.user.id, req.params.id));
  }));

  r.get("/categories", h(async (_req, res) => res.json(await catalog.categories())));
  r.get("/warehouses", h(async (_req, res) => res.json(await catalog.warehouses())));

  // ---------------------------------------------------------------- movimientos
  r.get("/movements", validate(S.movementQuery, "query"), h(async (req, res) => {
    res.json(await inventory.listMovements(req.validQuery));
  }));

  r.post("/movements", canWrite, validate(S.movementCreate), h(async (req, res) => {
    res.status(201).json(await inventory.recordMovement(req.user.id, req.body));
  }));

  // ---------------------------------------------------------------- tablero
  r.get("/dashboard", h(async (_req, res) => res.json(await dashboard.summary())));

  return r;
}

module.exports = { buildRouter };
