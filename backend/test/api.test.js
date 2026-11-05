const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers");

describe("Bodega API", () => {
  let ctx;
  before(async () => { ctx = await setup(); });
  after(async () => { await ctx.db.destroy(); });

  const stockIn = async (productId, warehouseId) => {
    const p = (await ctx.as("admin").get(`/api/products/${productId}`)).body;
    return p.byWarehouse.find((w) => w.id === warehouseId)?.quantity ?? 0;
  };

  describe("autenticación y permisos", () => {
    it("rechaza peticiones sin token", async () => {
      const res = await ctx.api.get("/api/products");
      assert.equal(res.status, 401);
    });

    it("rechaza una contraseña incorrecta", async () => {
      const res = await ctx.api.post("/api/auth/login").send({ email: "admin@bodega.co", password: "otra" });
      assert.equal(res.status, 401);
      assert.equal(res.body.title, "Credenciales inválidas");
    });

    it("el rol de consulta no puede registrar movimientos", async () => {
      const res = await ctx.as("viewer").post("/api/movements", { type: "IN", productId: 1, toWarehouseId: 1, quantity: 5 });
      assert.equal(res.status, 403);
    });

    it("solo el administrador puede desactivar productos", async () => {
      const res = await ctx.as("operator").delete("/api/products/1");
      assert.equal(res.status, 403);
    });
  });

  describe("movimientos", () => {
    it("un traslado mueve existencias entre bodegas sin cambiar el total", async () => {
      const before1 = await stockIn(1, 1);
      const before3 = await stockIn(1, 3);
      const totalBefore = (await ctx.as("admin").get("/api/products/1")).body.stock;

      const res = await ctx.as("operator").post("/api/movements", {
        type: "TRANSFER", productId: 1, fromWarehouseId: 1, toWarehouseId: 3, quantity: 10, reference: "EVT-TEST",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.from.id, 1);
      assert.equal(res.body.to.id, 3);

      assert.equal(await stockIn(1, 1), before1 - 10);
      assert.equal(await stockIn(1, 3), before3 + 10);
      assert.equal((await ctx.as("admin").get("/api/products/1")).body.stock, totalBefore);
    });

    it("rechaza una salida mayor que las existencias y no modifica nada", async () => {
      const available = await stockIn(2, 2);
      const res = await ctx.as("operator").post("/api/movements", {
        type: "OUT", productId: 2, fromWarehouseId: 2, quantity: available + 1,
      });
      assert.equal(res.status, 422);
      assert.equal(res.body.available, available);
      assert.equal(await stockIn(2, 2), available);
    });

    it("exige origen y destino distintos en un traslado", async () => {
      const res = await ctx.as("operator").post("/api/movements", {
        type: "TRANSFER", productId: 1, fromWarehouseId: 1, toWarehouseId: 1, quantity: 1,
      });
      assert.equal(res.status, 422);
    });

    it("un ajuste negativo no puede dejar el saldo por debajo de cero", async () => {
      const available = await stockIn(3, 2);
      const res = await ctx.as("admin").post("/api/movements", {
        type: "ADJUST", productId: 3, toWarehouseId: 2, quantity: -(available + 5),
      });
      assert.equal(res.status, 422);
      assert.equal(await stockIn(3, 2), available);
    });

    it("valida los datos de entrada", async () => {
      const res = await ctx.as("admin").post("/api/movements", { type: "VENTA", productId: "x", quantity: 2.5 });
      assert.equal(res.status, 400);
      assert.ok(res.body.errors.type);
      assert.ok(res.body.errors.productId);
      assert.ok(res.body.errors.quantity);
    });

    it("filtra el libro de movimientos por tipo", async () => {
      const res = await ctx.as("viewer").get("/api/movements?type=ADJUST");
      assert.equal(res.status, 200);
      assert.ok(res.body.items.length >= 1);
      assert.ok(res.body.items.every((m) => m.type === "ADJUST"));
    });
  });

  describe("kárdex", () => {
    it("el saldo final del kárdex coincide con las existencias del producto", async () => {
      for (const id of [1, 4, 6, 9]) {
        const kardex = (await ctx.as("viewer").get(`/api/products/${id}/kardex`)).body;
        const product = (await ctx.as("viewer").get(`/api/products/${id}`)).body;
        assert.equal(kardex.balance, product.stock, `producto ${id}`);
      }
    });

    it("el kárdex por bodega coincide con la existencia en esa bodega", async () => {
      const kardex = (await ctx.as("viewer").get("/api/products/1/kardex?warehouseId=3")).body;
      assert.equal(kardex.balance, await stockIn(1, 3));
    });
  });

  describe("catálogo y auditoría", () => {
    it("crea un producto, rechaza el SKU duplicado y audita los cambios", async () => {
      const body = { sku: "sil-tif-do", name: "Silla Tiffany dorada", category: "Mobiliario", unitCost: 41000, minStock: 100 };
      const created = await ctx.as("operator").post("/api/products", body);
      assert.equal(created.status, 201);
      assert.equal(created.body.sku, "SIL-TIF-DO");
      assert.equal(created.body.lowStock, true);

      const dup = await ctx.as("operator").post("/api/products", body);
      assert.equal(dup.status, 409);

      await ctx.as("operator").patch(`/api/products/${created.body.id}`, { unitCost: 43000 });
      const history = (await ctx.as("admin").get(`/api/products/${created.body.id}/history`)).body;
      assert.deepEqual(history.map((h) => h.action), ["UPDATE", "CREATE"]);
      assert.equal(Number(history[0].before.unit_cost), 41000);
      assert.equal(history[0].after.unit_cost, 43000);
    });

    it("filtra los productos bajo el stock mínimo", async () => {
      const res = await ctx.as("viewer").get("/api/products?lowStock=true");
      assert.ok(res.body.items.length > 0);
      assert.ok(res.body.items.every((p) => p.stock < p.minStock));
    });

    it("exporta el catálogo a CSV", async () => {
      const res = await ctx.as("viewer").get("/api/products/export.csv");
      assert.equal(res.status, 200);
      assert.match(res.headers["content-type"], /text\/csv/);
      assert.match(res.text, /SKU;Producto;Categoría/);
    });
  });

  describe("tablero", () => {
    it("resume totales, alertas y 14 días de actividad", async () => {
      const res = await ctx.as("viewer").get("/api/dashboard");
      assert.equal(res.status, 200);
      assert.equal(res.body.activity.length, 14);
      assert.ok(res.body.totals.value > 0);
      assert.equal(res.body.totals.lowStock, res.body.lowStock.length);
      assert.equal(res.body.warehouses.length, 4);
    });
  });
});
