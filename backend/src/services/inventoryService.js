const { businessRule, notFound } = require("../errors");
const { toDbDateTime } = require("../utils/time");

/**
 * Reglas de cada tipo de movimiento:
 *  IN        entrada a una bodega (compra, devolución). Requiere bodega destino.
 *  OUT       salida de una bodega (venta, consumo, baja). Requiere bodega origen y existencias suficientes.
 *  TRANSFER  traslado entre dos bodegas distintas. Requiere existencias en el origen.
 *  ADJUST    ajuste por conteo físico. La cantidad es positiva o negativa y el saldo no puede quedar negativo.
 */
const RULES = {
  IN: { from: false, to: true },
  OUT: { from: true, to: false },
  TRANSFER: { from: true, to: true },
  ADJUST: { from: false, to: true },
};

function createInventoryService(db) {
  const isMysql = db.client.config.client === "mysql2";

  /** Lee el saldo de una bodega bloqueando la fila en MySQL para evitar ventas dobles. */
  async function lockedQuantity(trx, productId, warehouseId) {
    let q = trx("stock_levels").where({ product_id: productId, warehouse_id: warehouseId }).first("quantity");
    if (isMysql) q = q.forUpdate();
    const row = await q;
    return row ? Number(row.quantity) : null;
  }

  async function addToStock(trx, productId, warehouseId, delta) {
    const current = await lockedQuantity(trx, productId, warehouseId);
    if (current === null) {
      await trx("stock_levels").insert({ product_id: productId, warehouse_id: warehouseId, quantity: delta });
      return delta;
    }
    await trx("stock_levels").where({ product_id: productId, warehouse_id: warehouseId }).update({ quantity: current + delta });
    return current + delta;
  }

  async function requireActive(trx, table, id, label) {
    const row = await trx(table).where({ id }).first();
    if (!row) throw notFound(label, id);
    if (!row.active) throw businessRule(`${label} "${row.name}" está inactivo`);
    return row;
  }

  /** Registra un movimiento y actualiza las existencias en una sola transacción. */
  async function recordMovement(userId, input) {
    const rule = RULES[input.type];
    const fromId = rule.from ? input.fromWarehouseId : null;
    const toId = rule.to ? input.toWarehouseId : null;

    if (rule.from && !fromId) throw businessRule("Este movimiento requiere la bodega de origen");
    if (rule.to && !toId) throw businessRule("Este movimiento requiere la bodega de destino");
    if (input.type === "TRANSFER" && fromId === toId) throw businessRule("El origen y el destino deben ser distintos");
    if (input.type !== "ADJUST" && input.quantity <= 0) throw businessRule("La cantidad debe ser mayor que cero");
    if (input.type === "ADJUST" && input.quantity === 0) throw businessRule("El ajuste no puede ser cero");

    return db.transaction(async (trx) => {
      const product = await requireActive(trx, "products", input.productId, "Producto");
      if (fromId) await requireActive(trx, "warehouses", fromId, "Bodega");
      if (toId) await requireActive(trx, "warehouses", toId, "Bodega");

      if (fromId) {
        const available = (await lockedQuantity(trx, product.id, fromId)) ?? 0;
        if (available < input.quantity) {
          throw businessRule(
            `Existencias insuficientes: hay ${available} ${available === 1 || !product.unit.endsWith("d") ? product.unit : `${product.unit}es`} y se piden ${input.quantity}`,
            { available },
          );
        }
        await addToStock(trx, product.id, fromId, -input.quantity);
      }
      if (toId) {
        const resulting = await addToStock(trx, product.id, toId, input.quantity);
        if (resulting < 0) {
          throw businessRule(`El ajuste dejaría el saldo en ${resulting}`);
        }
      }

      const record = {
        type: input.type,
        product_id: product.id,
        from_warehouse_id: fromId,
        to_warehouse_id: toId,
        quantity: input.quantity,
        unit_cost: input.unitCost ?? product.unit_cost,
        reference: input.reference || null,
        note: input.note || null,
        user_id: userId,
        // La fecha la pone la aplicación en hora local; createdAt solo lo usa el sembrado de datos.
        created_at: input.createdAt || toDbDateTime(),
      };
      const [id] = await trx("movements").insert(record);
      const movementId = typeof id === "object" ? id.id : id;
      return getMovement(movementId, trx);
    });
  }

  const movementSelect = (q) => q
    .select(
      "m.id", "m.type", "m.quantity", "m.unit_cost", "m.reference", "m.note", "m.created_at",
      "p.id as product_id", "p.sku", "p.name as product_name", "p.unit",
      "fw.id as from_id", "fw.name as from_name", "tw.id as to_id", "tw.name as to_name",
      "u.full_name as user_name",
    )
    .from("movements as m")
    .join("products as p", "p.id", "m.product_id")
    .join("users as u", "u.id", "m.user_id")
    .leftJoin("warehouses as fw", "fw.id", "m.from_warehouse_id")
    .leftJoin("warehouses as tw", "tw.id", "m.to_warehouse_id");

  const toMovementDto = (r) => ({
    id: r.id,
    type: r.type,
    quantity: Number(r.quantity),
    unitCost: Number(r.unit_cost),
    reference: r.reference,
    note: r.note,
    createdAt: r.created_at,
    product: { id: r.product_id, sku: r.sku, name: r.product_name, unit: r.unit },
    from: r.from_id ? { id: r.from_id, name: r.from_name } : null,
    to: r.to_id ? { id: r.to_id, name: r.to_name } : null,
    user: r.user_name,
  });

  async function getMovement(id, conn = db) {
    const row = await movementSelect(conn.queryBuilder()).where("m.id", id).first();
    return toMovementDto(row);
  }

  async function listMovements({ productId, type, warehouseId, from, to, page = 1, size = 25 }) {
    const base = db.queryBuilder();
    const filtered = (q) => {
      if (productId) q.where("m.product_id", productId);
      if (type) q.where("m.type", type);
      if (warehouseId) q.where((w) => w.where("m.from_warehouse_id", warehouseId).orWhere("m.to_warehouse_id", warehouseId));
      if (from) q.where("m.created_at", ">=", `${from} 00:00:00`);
      if (to) q.where("m.created_at", "<=", `${to} 23:59:59`);
      return q;
    };
    const [{ total }] = await filtered(db("movements as m")).count({ total: "*" });
    const rows = await filtered(movementSelect(base))
      .orderBy("m.created_at", "desc").orderBy("m.id", "desc")
      .limit(size).offset((page - 1) * size);
    return { items: rows.map(toMovementDto), page, size, total: Number(total) };
  }

  /**
   * Kárdex: historial del producto con saldo acumulado.
   * Si se indica bodega, solo cuenta lo que entra y sale de esa bodega.
   */
  async function kardex(productId, warehouseId) {
    const product = await db("products").where({ id: productId }).first();
    if (!product) throw notFound("Producto", productId);

    const q = movementSelect(db.queryBuilder()).where("m.product_id", productId)
      .orderBy("m.created_at", "asc").orderBy("m.id", "asc");
    if (warehouseId) q.where((w) => w.where("m.from_warehouse_id", warehouseId).orWhere("m.to_warehouse_id", warehouseId));
    const rows = (await q).map(toMovementDto);

    let balance = 0;
    const entries = rows.map((m) => {
      let delta;
      if (warehouseId) {
        delta = (m.to?.id === Number(warehouseId) ? m.quantity : 0) - (m.from?.id === Number(warehouseId) ? m.quantity : 0);
      } else {
        delta = m.type === "IN" || m.type === "ADJUST" ? m.quantity : m.type === "OUT" ? -m.quantity : 0;
      }
      balance += delta;
      return { ...m, delta, balance };
    });
    return {
      product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
      warehouseId: warehouseId ? Number(warehouseId) : null,
      entries,
      balance,
    };
  }

  return { recordMovement, getMovement, listMovements, kardex, RULES };
}

module.exports = { createInventoryService };
