// API simulada para el modo demo. Usa los mismos datos de ejemplo que el backend
// (seed-data.js) y replica las reglas de inventoryService.js.
import { SEED } from "./seed-data.js";

const STORE_KEY = "bodega-demo-v1";
const USERS = {
  ADMIN: { id: 1, fullName: "Paula Moreno", role: "ADMIN" },
  OPERATOR: { id: 2, fullName: "Jhon Ramírez", role: "OPERATOR" },
  VIEWER: { id: 3, fullName: "Auditoría externa", role: "VIEWER" },
};

export class ApiError extends Error {
  constructor(status, title, detail, extra = {}) {
    super(detail);
    Object.assign(this, { status, title }, extra);
  }
}

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const reply = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 120));

function fromSeed() {
  const movements = SEED.movements.map((m) => {
    const d = new Date();
    d.setDate(d.getDate() - m.daysAgo);
    const [h, mi] = m.time.split(":").map(Number);
    d.setHours(h, mi, 0, 0);
    return { ...m, createdAt: stamp(d) };
  });
  return { products: SEED.products.map((p) => ({ ...p, active: true })), warehouses: SEED.warehouses, movements, seq: movements.length + 1 };
}

let db = (() => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* sin almacenamiento */ }
  return fromSeed();
})();
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ } };

let user = null;
const requireWrite = () => {
  if (!["ADMIN", "OPERATOR"].includes(user?.role)) {
    throw new ApiError(403, "Acceso denegado", "Tu rol no tiene permiso para esta operación");
  }
};

/** Existencias por producto y bodega, recalculadas desde el libro de movimientos. */
function levels() {
  const map = new Map();
  const add = (p, w, q) => map.set(`${p}:${w}`, (map.get(`${p}:${w}`) || 0) + q);
  for (const m of db.movements) {
    if (m.fromId) add(m.productId, m.fromId, -m.quantity);
    if (m.toId) add(m.productId, m.toId, m.quantity);
  }
  return map;
}

const productDto = (p, lv) => {
  const stock = db.warehouses.reduce((n, w) => n + (lv.get(`${p.id}:${w.id}`) || 0), 0);
  return { ...p, stock, lowStock: stock < p.minStock };
};

const movementDto = (m) => {
  const p = db.products.find((x) => x.id === m.productId);
  const wf = db.warehouses.find((w) => w.id === m.fromId);
  const wt = db.warehouses.find((w) => w.id === m.toId);
  return {
    id: m.id, type: m.type, quantity: m.quantity, unitCost: m.unitCost, reference: m.reference, note: m.note,
    createdAt: m.createdAt, user: m.user,
    product: { id: p.id, sku: p.sku, name: p.name, unit: p.unit },
    from: wf ? { id: wf.id, name: wf.name } : null,
    to: wt ? { id: wt.id, name: wt.name } : null,
  };
};

const sorted = () => [...db.movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

export const mockApi = {
  mode: "demo",

  async login(role) {
    user = USERS[role];
    return reply({ token: "demo", user });
  },

  async products({ search, category, lowStock } = {}) {
    const lv = levels();
    let items = db.products.filter((p) => p.active).map((p) => productDto(p, lv));
    if (category) items = items.filter((p) => p.category === category);
    if (search) {
      const t = search.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t));
    }
    if (lowStock) items = items.filter((p) => p.lowStock);
    items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return reply({ items, page: 1, size: items.length, total: items.length });
  },

  async product(id) {
    const lv = levels();
    const p = db.products.find((x) => x.id === Number(id));
    const byWarehouse = db.warehouses.map((w) => ({ id: w.id, name: w.name, quantity: lv.get(`${p.id}:${w.id}`) || 0 }))
      .filter((w) => w.quantity !== 0);
    return reply({ ...productDto(p, lv), byWarehouse });
  },

  async categories() {
    return reply([...new Set(db.products.map((p) => p.category))].sort());
  },

  async warehouses() {
    const lv = levels();
    return reply(db.warehouses.map((w) => {
      let units = 0;
      let value = 0;
      for (const p of db.products) {
        const q = lv.get(`${p.id}:${w.id}`) || 0;
        units += q;
        value += q * p.unitCost;
      }
      return { ...w, active: true, units, value };
    }));
  },

  async movements({ type, productId, warehouseId, page = 1, size = 25 } = {}) {
    let rows = sorted();
    if (type) rows = rows.filter((m) => m.type === type);
    if (productId) rows = rows.filter((m) => m.productId === Number(productId));
    if (warehouseId) rows = rows.filter((m) => m.fromId === Number(warehouseId) || m.toId === Number(warehouseId));
    return reply({ items: rows.slice((page - 1) * size, page * size).map(movementDto), page, size, total: rows.length });
  },

  async recordMovement(input) {
    requireWrite();
    const rules = { IN: [false, true], OUT: [true, false], TRANSFER: [true, true], ADJUST: [false, true] }[input.type];
    const fromId = rules[0] ? Number(input.fromWarehouseId) || null : null;
    const toId = rules[1] ? Number(input.toWarehouseId) || null : null;
    const qty = Number(input.quantity);
    const p = db.products.find((x) => x.id === Number(input.productId));
    const fail = (detail, extra) => { throw new ApiError(422, "Regla de negocio", detail, extra); };

    if (!p) throw new ApiError(400, "Datos inválidos", "Selecciona un producto");
    if (!Number.isInteger(qty)) throw new ApiError(400, "Datos inválidos", "La cantidad debe ser un número entero");
    if (rules[0] && !fromId) fail("Este movimiento requiere la bodega de origen");
    if (rules[1] && !toId) fail("Este movimiento requiere la bodega de destino");
    if (input.type === "TRANSFER" && fromId === toId) fail("El origen y el destino deben ser distintos");
    if (input.type !== "ADJUST" && qty <= 0) fail("La cantidad debe ser mayor que cero");
    if (input.type === "ADJUST" && qty === 0) fail("El ajuste no puede ser cero");

    const lv = levels();
    if (fromId) {
      const available = lv.get(`${p.id}:${fromId}`) || 0;
      if (available < qty) fail(`Existencias insuficientes: hay ${available} ${available === 1 ? p.unit : `${p.unit}es`} y se piden ${qty}`, { available });
    }
    if (input.type === "ADJUST" && (lv.get(`${p.id}:${toId}`) || 0) + qty < 0) {
      fail(`El ajuste dejaría el saldo en ${(lv.get(`${p.id}:${toId}`) || 0) + qty}`);
    }

    const m = {
      id: db.seq++, type: input.type, productId: p.id, fromId, toId, quantity: qty, unitCost: p.unitCost,
      reference: input.reference || null, note: input.note || null, user: user.fullName, createdAt: stamp(new Date()),
    };
    db.movements.push(m);
    persist();
    return reply(movementDto(m));
  },

  async kardex(productId, warehouseId) {
    const p = db.products.find((x) => x.id === Number(productId));
    const wid = warehouseId ? Number(warehouseId) : null;
    let rows = [...db.movements].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    if (wid) rows = rows.filter((m) => m.fromId === wid || m.toId === wid);
    let balance = 0;
    const entries = rows.filter((m) => m.productId === p.id).map((m) => {
      const delta = wid
        ? (m.toId === wid ? m.quantity : 0) - (m.fromId === wid ? m.quantity : 0)
        : m.type === "IN" || m.type === "ADJUST" ? m.quantity : m.type === "OUT" ? -m.quantity : 0;
      balance += delta;
      return { ...movementDto(m), delta, balance };
    });
    return reply({ product: { id: p.id, sku: p.sku, name: p.name, unit: p.unit }, warehouseId: wid, entries, balance });
  },

  async dashboard() {
    const days = 14;
    const lv = levels();
    const products = db.products.filter((p) => p.active).map((p) => productDto(p, lv));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const activity = [...Array(days)].map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { date: stamp(d).slice(0, 10), IN: 0, OUT: 0, TRANSFER: 0, ADJUST: 0 };
    });
    let count = 0;
    for (const m of db.movements) {
      const bucket = activity.find((a) => a.date === m.createdAt.slice(0, 10));
      if (bucket) { bucket[m.type] += Math.abs(m.quantity); count += 1; }
    }
    const lowStock = products.filter((p) => p.lowStock)
      .sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));
    return reply({
      totals: {
        products: products.length,
        units: products.reduce((n, p) => n + p.stock, 0),
        value: Math.round(products.reduce((n, p) => n + p.stock * p.unitCost, 0)),
        lowStock: lowStock.length,
        movements: count,
      },
      lowStock,
      warehouses: await this.warehouses(),
      activity,
    });
  },

  csvUrl: null,
  reset() { db = fromSeed(); persist(); },
};
