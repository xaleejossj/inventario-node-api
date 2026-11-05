function createDashboardService(db, catalog) {
  /** Indicadores del tablero: valor del inventario, alertas y actividad de los últimos días. */
  async function summary({ days = 14 } = {}) {
    const { items: products } = await catalog.listProducts({ size: 100000 });
    const warehouses = await catalog.warehouses();

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")} 00:00:00`;

    const rows = await db("movements")
      .where("created_at", ">=", sinceStr)
      .select("type", "quantity", "created_at");

    // Agrupa en JavaScript para no depender de funciones de fecha de cada motor.
    const perDay = new Map();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      perDay.set(key, { date: key, IN: 0, OUT: 0, TRANSFER: 0, ADJUST: 0 });
    }
    for (const r of rows) {
      const key = String(r.created_at).slice(0, 10);
      const bucket = perDay.get(key);
      if (bucket) bucket[r.type] += Math.abs(Number(r.quantity));
    }

    const lowStock = products.filter((p) => p.lowStock)
      .map((p) => ({ id: p.id, sku: p.sku, name: p.name, stock: p.stock, minStock: p.minStock, unit: p.unit }))
      .sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));

    return {
      totals: {
        products: products.length,
        units: products.reduce((n, p) => n + p.stock, 0),
        value: Math.round(products.reduce((n, p) => n + p.stock * p.unitCost, 0)),
        lowStock: lowStock.length,
        movements: rows.length,
      },
      lowStock,
      warehouses,
      activity: [...perDay.values()],
    };
  }

  return { summary };
}

module.exports = { createDashboardService };
