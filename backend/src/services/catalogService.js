const { conflict, notFound } = require("../errors");
const { toDbDateTime } = require("../utils/time");

function createCatalogService(db) {
  const toProductDto = (p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    unitCost: Number(p.unit_cost),
    minStock: Number(p.min_stock),
    active: Boolean(p.active),
    stock: Number(p.stock ?? 0),
    lowStock: Number(p.stock ?? 0) < Number(p.min_stock),
  });

  /** Productos con su existencia total (suma de todas las bodegas). */
  const productsWithStock = () => db("products as p")
    .leftJoin("stock_levels as s", "s.product_id", "p.id")
    .groupBy("p.id", "p.sku", "p.name", "p.category", "p.unit", "p.unit_cost", "p.min_stock", "p.active")
    .select("p.id", "p.sku", "p.name", "p.category", "p.unit", "p.unit_cost", "p.min_stock", "p.active")
    .select(db.raw("coalesce(sum(s.quantity), 0) as stock"));

  async function listProducts({ search, category, lowStock, includeInactive, page = 1, size = 50 }) {
    const q = productsWithStock();
    if (!includeInactive) q.where("p.active", true);
    if (category) q.where("p.category", category);
    if (search) {
      const term = `%${search.toLowerCase()}%`;
      q.where((w) => w.whereRaw("lower(p.name) like ?", [term]).orWhereRaw("lower(p.sku) like ?", [term]));
    }
    if (lowStock) q.havingRaw("coalesce(sum(s.quantity), 0) < p.min_stock");

    const all = (await q.orderBy("p.category").orderBy("p.name")).map(toProductDto);
    const items = all.slice((page - 1) * size, page * size);
    return { items, page, size, total: all.length };
  }

  async function getProduct(id) {
    const p = await productsWithStock().where("p.id", id).first();
    if (!p) throw notFound("Producto", id);
    const byWarehouse = await db("stock_levels as s")
      .join("warehouses as w", "w.id", "s.warehouse_id")
      .where("s.product_id", id)
      .select("w.id", "w.name", "s.quantity")
      .orderBy("w.name");
    return { ...toProductDto(p), byWarehouse: byWarehouse.map((r) => ({ ...r, quantity: Number(r.quantity) })) };
  }

  async function audit(trx, { entityId, action, before, after, userId }) {
    await trx("audit_log").insert({
      entity: "product",
      entity_id: entityId,
      action,
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      user_id: userId,
      created_at: toDbDateTime(),
    });
  }

  const toRow = (input) => ({
    sku: input.sku?.toUpperCase(),
    name: input.name,
    category: input.category,
    unit: input.unit,
    unit_cost: input.unitCost,
    min_stock: input.minStock,
  });

  async function createProduct(userId, input) {
    const exists = await db("products").whereRaw("upper(sku) = ?", [input.sku.toUpperCase()]).first();
    if (exists) throw conflict(`Ya existe un producto con el SKU ${input.sku.toUpperCase()}`);
    return db.transaction(async (trx) => {
      const [id] = await trx("products").insert(toRow(input));
      const newId = typeof id === "object" ? id.id : id;
      await audit(trx, { entityId: newId, action: "CREATE", after: input, userId });
      return newId;
    }).then(getProduct);
  }

  async function updateProduct(userId, id, input) {
    const before = await db("products").where({ id }).first();
    if (!before) throw notFound("Producto", id);
    if (input.sku && input.sku.toUpperCase() !== before.sku) {
      const dup = await db("products").whereRaw("upper(sku) = ?", [input.sku.toUpperCase()]).whereNot({ id }).first();
      if (dup) throw conflict(`Ya existe un producto con el SKU ${input.sku.toUpperCase()}`);
    }
    const changes = Object.fromEntries(Object.entries(toRow(input)).filter(([, v]) => v !== undefined));
    if (input.active !== undefined) changes.active = input.active;
    await db.transaction(async (trx) => {
      await trx("products").where({ id }).update({ ...changes, updated_at: toDbDateTime() });
      await audit(trx, { entityId: Number(id), action: "UPDATE", before, after: changes, userId });
    });
    return getProduct(id);
  }

  /** Borrado lógico: el producto conserva su historial de movimientos. */
  async function deactivateProduct(userId, id) {
    return updateProduct(userId, id, { active: false });
  }

  async function productHistory(id) {
    const rows = await db("audit_log as a").leftJoin("users as u", "u.id", "a.user_id")
      .where({ "a.entity": "product", "a.entity_id": id })
      .orderBy("a.created_at", "desc").orderBy("a.id", "desc")
      .select("a.id", "a.action", "a.before_json", "a.after_json", "a.created_at", "u.full_name as user");
    return rows.map((r) => ({
      id: r.id, action: r.action, user: r.user, createdAt: r.created_at,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    }));
  }

  async function categories() {
    return (await db("products").distinct("category").where("active", true).orderBy("category")).map((r) => r.category);
  }

  async function warehouses() {
    const rows = await db("warehouses as w")
      .leftJoin("stock_levels as s", "s.warehouse_id", "w.id")
      .leftJoin("products as p", "p.id", "s.product_id")
      .groupBy("w.id", "w.code", "w.name", "w.city", "w.active")
      .select("w.id", "w.code", "w.name", "w.city", "w.active")
      .select(db.raw("coalesce(sum(s.quantity), 0) as units"))
      .select(db.raw("coalesce(sum(s.quantity * p.unit_cost), 0) as value"))
      .orderBy("w.id");
    return rows.map((w) => ({ ...w, active: Boolean(w.active), units: Number(w.units), value: Number(w.value) }));
  }

  /** Exporta el catálogo con existencias a CSV (separador ";" para que Excel en español lo abra bien). */
  async function exportCsv() {
    const { items } = await listProducts({ size: 100000 });
    const esc = (v) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["SKU", "Producto", "Categoría", "Unidad", "Costo unitario", "Existencias", "Mínimo", "Bajo mínimo"];
    const lines = items.map((p) => [p.sku, p.name, p.category, p.unit, p.unitCost, p.stock, p.minStock, p.lowStock ? "Sí" : "No"].map(esc).join(";"));
    return `﻿${[header.join(";"), ...lines].join("\n")}\n`;
  }

  return { listProducts, getProduct, createProduct, updateProduct, deactivateProduct, productHistory, categories, warehouses, exportCsv };
}

module.exports = { createCatalogService };
