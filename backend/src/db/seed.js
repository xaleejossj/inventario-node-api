const bcrypt = require("bcryptjs");
const { createInventoryService } = require("../services/inventoryService");
const { toDbDateTime } = require("../utils/time");

const DEMO_PASSWORD = "Demo1234*";

// Inventario de una empresa de alquiler de mobiliario y equipos para eventos.
const WAREHOUSES = [
  { code: "BOG-CEN", name: "Bodega central", city: "Bogotá" },
  { code: "BOG-SUR", name: "Bodega sur", city: "Bogotá" },
  { code: "EVT-CRF", name: "Evento Corferias", city: "Bogotá" },
  { code: "TALLER", name: "Taller de mantenimiento", city: "Bogotá" },
];

const PRODUCTS = [
  ["SIL-TIF-BL", "Silla Tiffany blanca", "Mobiliario", "unidad", 38000, 300, 420],
  ["SIL-PLE-NG", "Silla plegable negra", "Mobiliario", "unidad", 22000, 250, 380],
  ["MES-RED-180", "Mesa redonda 1,80 m", "Mobiliario", "unidad", 145000, 40, 64],
  ["MES-TAB-240", "Mesa tablón 2,40 m", "Mobiliario", "unidad", 120000, 30, 26],
  ["MAN-BLA-RED", "Mantel redondo blanco", "Lencería", "unidad", 18000, 60, 90],
  ["CAM-SAT-AZ", "Camino de mesa satín azul", "Lencería", "unidad", 9000, 50, 35],
  ["CAR-10X10", "Carpa 10 x 10 m", "Estructuras", "unidad", 4800000, 3, 5],
  ["TAR-MOD-1M", "Módulo de tarima 1 x 1 m", "Estructuras", "unidad", 260000, 40, 56],
  ["PAR-ACT-15", "Parlante activo 15\"", "Sonido", "unidad", 1650000, 8, 12],
  ["MIC-INAL", "Micrófono inalámbrico", "Sonido", "unidad", 540000, 10, 9],
  ["CAB-XLR-10", "Cable XLR 10 m", "Sonido", "unidad", 42000, 40, 70],
  ["LUZ-PAR-LED", "Luz PAR LED RGBW", "Iluminación", "unidad", 380000, 24, 30],
  ["CAB-POT-25", "Extensión de potencia 25 m", "Eléctrico", "unidad", 95000, 30, 22],
  ["PLA-6500W", "Planta eléctrica 6,5 kW", "Eléctrico", "unidad", 6200000, 2, 3],
];

/** Generador pseudoaleatorio con semilla, para que los datos de ejemplo sean siempre los mismos. */
function rng(seedValue) {
  let s = seedValue;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function seed(db, { days = 21 } = {}) {
  if ((await db("users").count({ n: "*" }))[0].n > 0) return false;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db("users").insert([
    { full_name: "Paula Moreno", email: "admin@bodega.co", password_hash: hash, role: "ADMIN" },
    { full_name: "Jhon Ramírez", email: "operador@bodega.co", password_hash: hash, role: "OPERATOR" },
    { full_name: "Auditoría externa", email: "consulta@bodega.co", password_hash: hash, role: "VIEWER" },
  ]);
  await db("warehouses").insert(WAREHOUSES);
  await db("products").insert(PRODUCTS.map(([sku, name, category, unit, cost, min]) => ({
    sku, name, category, unit, unit_cost: cost, min_stock: min,
  })));

  const products = await db("products").orderBy("id");
  const wh = Object.fromEntries((await db("warehouses")).map((w) => [w.code, w.id]));
  const inventory = createInventoryService(db);
  const rand = rng(2026);

  const at = (daysAgo, hour) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, Math.floor(rand() * 60), 0, 0);
    return toDbDateTime(d);
  };

  // Compra inicial hace "days" días: casi todo a la bodega central, una parte a la bodega sur.
  for (const p of products) {
    const initial = PRODUCTS.find((x) => x[0] === p.sku)[6];
    const south = Math.floor(initial * 0.25);
    await inventory.recordMovement(1, { type: "IN", productId: p.id, toWarehouseId: wh["BOG-CEN"], quantity: initial - south, reference: "OC-2026-0141", note: "Compra inicial", createdAt: at(days, 8) });
    if (south > 0) await inventory.recordMovement(1, { type: "IN", productId: p.id, toWarehouseId: wh["BOG-SUR"], quantity: south, reference: "OC-2026-0142", note: "Compra inicial", createdAt: at(days, 9) });
  }

  // Actividad diaria: despachos a eventos, devoluciones, envíos a mantenimiento y salidas por daño.
  const notes = {
    TRANSFER: ["Montaje feria del hogar", "Boda en Chía", "Congreso médico", "Lanzamiento de marca"],
    OUT: ["Baja por daño", "Venta de inventario usado", "Pérdida en evento"],
    IN: ["Reposición de proveedor", "Devolución de cliente"],
  };
  for (let d = days - 1; d >= 0; d -= 1) {
    const actions = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < actions; i += 1) {
      const p = products[Math.floor(rand() * products.length)];
      const roll = rand();
      const big = Number(p.min_stock) > 20;
      const qty = big ? 5 + Math.floor(rand() * 40) : 1 + Math.floor(rand() * 2);
      const hour = 7 + Math.floor(rand() * 11);
      try {
        if (roll < 0.45) {
          await inventory.recordMovement(2, { type: "TRANSFER", productId: p.id, fromWarehouseId: wh["BOG-CEN"], toWarehouseId: wh["EVT-CRF"], quantity: qty, reference: `EVT-${1200 + d}`, note: notes.TRANSFER[d % 4], createdAt: at(d, hour) });
        } else if (roll < 0.7) {
          await inventory.recordMovement(2, { type: "TRANSFER", productId: p.id, fromWarehouseId: wh["EVT-CRF"], toWarehouseId: wh["BOG-CEN"], quantity: qty, reference: `EVT-${1200 + d}`, note: "Regreso de evento", createdAt: at(d, hour) });
        } else if (roll < 0.8) {
          await inventory.recordMovement(2, { type: "TRANSFER", productId: p.id, fromWarehouseId: wh["BOG-CEN"], toWarehouseId: wh.TALLER, quantity: Math.max(1, Math.floor(qty / 4)), note: "Revisión y reparación", createdAt: at(d, hour) });
        } else if (roll < 0.9) {
          await inventory.recordMovement(2, { type: "OUT", productId: p.id, fromWarehouseId: wh["BOG-CEN"], quantity: Math.max(1, Math.floor(qty / 5)), reference: `BAJA-${300 + d}`, note: notes.OUT[d % 3], createdAt: at(d, hour) });
        } else {
          await inventory.recordMovement(1, { type: "IN", productId: p.id, toWarehouseId: wh["BOG-CEN"], quantity: qty, reference: `FAC-${8800 + d}`, note: notes.IN[d % 2], createdAt: at(d, hour) });
        }
      } catch {
        // Sin existencias suficientes para ese movimiento simulado: se omite, igual que lo rechazaría la API.
      }
    }
  }
  // Un ajuste por conteo físico para que el kárdex muestre todos los tipos.
  const counted = await db("stock_levels").where({ warehouse_id: wh["BOG-CEN"] }).where("quantity", ">=", 10)
    .orderBy("product_id").first("product_id");
  if (counted) {
    await inventory.recordMovement(1, { type: "ADJUST", productId: counted.product_id, toWarehouseId: wh["BOG-CEN"], quantity: -3, reference: "INV-FIS-11", note: "Conteo físico: faltantes", createdAt: at(2, 17) });
  }
  return true;
}

module.exports = { seed, DEMO_PASSWORD };
