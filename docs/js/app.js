import { mockApi } from "./mock-api.js";
import { createHttpApi } from "./http-api.js";

const config = window.BODEGA_CONFIG || {};
const api = config.API_URL ? createHttpApi(config.API_URL) : mockApi;

const TYPE = {
  IN: { label: "Entrada", help: "Compra o devolución" },
  OUT: { label: "Salida", help: "Venta, baja o pérdida" },
  TRANSFER: { label: "Traslado", help: "Entre dos bodegas" },
  ADJUST: { label: "Ajuste", help: "Conteo físico (+ o −)" },
};

const app = document.getElementById("app");
const state = { user: null, warehouses: [], products: [], categories: [] };
const fmtInt = new Intl.NumberFormat("es-CO");
const fmtMoney = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseStamp = (s) => new Date(String(s).replace(" ", "T"));
const when = (s) => {
  const d = parseStamp(s);
  return `${fmtDate.format(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const plural = (n, unit) => (Math.abs(n) === 1 || !unit.endsWith("d") ? unit : `${unit}es`);
const tag = (type) => `<span class="tag t-${type}">${TYPE[type].label}</span>`;
const canWrite = () => ["ADMIN", "OPERATOR"].includes(state.user?.role);

let toastTimer;
function toast(msg, error = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3800);
}
async function attempt(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(e.message || "No se pudo completar la operación", true);
    return undefined;
  }
}

// ------------------------------------------------------------------ arranque y navegación

async function boot() {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  if (api.mode === "demo") {
    banner.innerHTML = `<span>Modo demo: los movimientos se guardan en tu navegador y siguen las mismas reglas que la API en Node.js.</span><button type="button" id="reset">Restablecer datos</button>`;
    banner.querySelector("#reset").onclick = () => { api.reset(); route(); toast("Datos de ejemplo restablecidos"); };
  } else {
    banner.textContent = `Conectado a la API en ${config.API_URL}`;
  }
  document.getElementById("role").onchange = (e) => login(e.target.value).then(route);
  window.addEventListener("hashchange", route);
  await login("OPERATOR");
  route();
}

async function login(role) {
  const r = await attempt(() => api.login(role));
  if (!r) {
    app.innerHTML = `<p class="empty">No se pudo conectar con la API. Revisa que esté encendida y la URL en config.js.</p>`;
    return;
  }
  state.user = r.user;
  [state.warehouses, state.categories] = await Promise.all([api.warehouses(), api.categories()]);
  state.products = (await api.products()).items;
}

function route() {
  if (!state.user) return;
  const view = (location.hash.replace("#", "").split("/")[0]) || "inventario";
  document.querySelectorAll(".tabs-main a").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (view === "movimientos") return renderMovements();
  if (view === "kardex") return renderKardex(location.hash.split("/")[1]);
  return renderInventory();
}

// ------------------------------------------------------------------ inventario

const invFilters = { search: "", category: "", lowStock: false };

async function renderInventory() {
  const dash = await attempt(() => api.dashboard());
  if (!dash) return;
  const t = dash.totals;
  app.innerHTML = `
    <div class="head">
      <div>
        <h1>Existencias frente al mínimo</h1>
        <div class="totals">
          <span><b class="num">${t.products}</b> productos</span>
          <span><b class="num">${fmtInt.format(t.units)}</b> unidades</span>
          <span><b class="num">${fmtMoney.format(t.value)}</b> en inventario</span>
          <span><b class="num">${t.lowStock}</b> bajo el mínimo</span>
        </div>
      </div>
    </div>
    <div class="inv-layout">
      <section class="card" aria-label="Existencias por producto">
        <div class="card-head">
          <div class="filters">
            <input class="input" type="search" id="f-search" placeholder="Buscar por nombre o SKU" value="${esc(invFilters.search)}" aria-label="Buscar producto">
            <select class="input" id="f-cat" aria-label="Categoría">
              <option value="">Todas las categorías</option>
              ${state.categories.map((c) => `<option ${c === invFilters.category ? "selected" : ""}>${esc(c)}</option>`).join("")}
            </select>
            <label class="check"><input type="checkbox" id="f-low" ${invFilters.lowStock ? "checked" : ""}> Solo bajo el mínimo</label>
          </div>
          <span class="hint">La raya vertical marca el mínimo</span>
        </div>
        <ul class="gauges" id="gauges"></ul>
      </section>
      <aside class="side">
        <section class="card">
          <div class="card-head"><h2>Bodegas</h2></div>
          <ul class="wh-list">${dash.warehouses.map((w) => `
            <li><div><div>${esc(w.name)}</div><div class="code">${esc(w.code)} · ${esc(w.city)}</div></div>
            <div class="val"><b>${fmtMoney.format(w.value)}</b><small>${fmtInt.format(w.units)} unidades</small></div></li>`).join("")}
          </ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Unidades movidas, últimos 14 días</h2></div>
          <div class="pad">${activityChart(dash.activity)}
            <div class="legend">${Object.keys(TYPE).map((k) => `<span class="t-${k}">${TYPE[k].label}</span>`).join("")}</div>
          </div>
        </section>
      </aside>
    </div>`;

  let timer;
  document.getElementById("f-search").oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { invFilters.search = e.target.value.trim(); loadGauges(); }, 200);
  };
  document.getElementById("f-cat").onchange = (e) => { invFilters.category = e.target.value; loadGauges(); };
  document.getElementById("f-low").onchange = (e) => { invFilters.lowStock = e.target.checked; loadGauges(); };
  await loadGauges();
}

async function loadGauges() {
  const { items } = await api.products(invFilters);
  const list = document.getElementById("gauges");
  if (!items.length) {
    list.innerHTML = `<li class="empty">Ningún producto coincide con los filtros.</li>`;
    return;
  }
  let lastCat = null;
  list.innerHTML = items.map((p) => {
    const scale = Math.max(p.stock, p.minStock * 2, 1);
    const head = p.category !== lastCat ? `<li class="gauge-cat">${esc(p.category)}</li>` : "";
    lastCat = p.category;
    return `${head}<li class="gauge ${p.lowStock ? "low" : ""}" data-id="${p.id}" tabindex="0" role="link" aria-label="${esc(p.name)}: ${p.stock} de mínimo ${p.minStock}. Ver kárdex">
      <span class="sku">${esc(p.sku)}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="meter" aria-hidden="true">
        <span class="fill" style="width:${(p.stock / scale) * 100}%"></span>
        <span class="min" style="left:${(p.minStock / scale) * 100}%" data-label="mín. ${p.minStock}"></span>
      </span>
      <span class="qty"><b>${fmtInt.format(p.stock)}</b><small>${p.lowStock ? `faltan ${fmtInt.format(p.minStock - p.stock)}` : esc(plural(p.stock, p.unit))}</small></span>
    </li>`;
  }).join("");
  list.querySelectorAll(".gauge").forEach((li) => {
    const go = () => { location.hash = `kardex/${li.dataset.id}`; };
    li.onclick = go;
    li.onkeydown = (e) => { if (e.key === "Enter") go(); };
  });
}

function activityChart(activity) {
  const W = 320;
  const H = 150;
  const padB = 18;
  const types = ["IN", "OUT", "TRANSFER", "ADJUST"];
  const colors = { IN: "#2F7D4F", OUT: "#B83227", TRANSFER: "#2B63A8", ADJUST: "#8A6A00" };
  const max = Math.max(1, ...activity.map((d) => types.reduce((n, t) => n + d[t], 0)));
  const bw = W / activity.length;
  const bars = activity.map((d, i) => {
    let y = H - padB;
    const x = i * bw + 3;
    const segs = types.map((t) => {
      const h = (d[t] / max) * (H - padB - 8);
      y -= h;
      return h > 0 ? `<rect x="${x}" y="${y}" width="${bw - 6}" height="${h}" fill="${colors[t]}"><title>${TYPE[t].label}: ${d[t]}</title></rect>` : "";
    }).join("");
    const day = new Date(`${d.date}T00:00`);
    const label = i % 2 === activity.length % 2 ? "" : `<text x="${x + (bw - 6) / 2}" y="${H - 4}" text-anchor="middle">${day.getDate()}</text>`;
    return segs + label;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Unidades movidas por día y tipo de movimiento">
    <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="#D5D9DE"/>
    <text x="0" y="9">${fmtInt.format(max)}</text>${bars}</svg>`;
}

// ------------------------------------------------------------------ movimientos

const movState = { page: 1, type: "", fresh: null };

async function renderMovements() {
  state.products = (await api.products()).items;
  const writable = canWrite();
  app.innerHTML = `
    <div class="head"><div><h1>Movimientos</h1><p class="sub">Cada entrada, salida, traslado y ajuste queda en un libro que no se puede editar.</p></div></div>
    <div class="mov-layout">
      <section class="card" aria-label="Registrar movimiento">
        <div class="card-head"><h2>Registrar movimiento</h2></div>
        <form class="form pad" id="mv-form" novalidate>
          ${writable ? "" : `<p class="locked">Tu perfil es de solo consulta. Cambia a Operador o Administración para registrar movimientos.</p>`}
          <fieldset class="types field" ${writable ? "" : "disabled"}>
            <legend>Tipo</legend>
            ${Object.entries(TYPE).map(([k, v], i) => `
              <input type="radio" name="type" id="ty-${k}" value="${k}" ${i === 2 ? "checked" : ""}>
              <label for="ty-${k}" class="t-${k}">${v.label}<small>${v.help}</small></label>`).join("")}
          </fieldset>
          <div class="field">
            <label for="mv-product">Producto</label>
            <select class="input" id="mv-product" ${writable ? "" : "disabled"}>
              ${state.products.map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.name)}</option>`).join("")}
            </select>
          </div>
          <div class="row2">
            <div class="field" id="fld-from"><label for="mv-from">Desde</label>${whSelect("mv-from", 1, writable)}</div>
            <div class="field" id="fld-to"><label for="mv-to">Hacia</label>${whSelect("mv-to", 3, writable)}</div>
          </div>
          <div class="avail" id="avail" aria-live="polite"></div>
          <div class="row2">
            <div class="field"><label for="mv-qty">Cantidad</label><input class="input num" id="mv-qty" type="number" step="1" value="10" ${writable ? "" : "disabled"}></div>
            <div class="field"><label for="mv-ref">Referencia</label><input class="input" id="mv-ref" maxlength="60" placeholder="EVT-1250" ${writable ? "" : "disabled"}></div>
          </div>
          <div class="field"><label for="mv-note">Nota</label><input class="input" id="mv-note" maxlength="255" placeholder="Montaje feria del hogar" ${writable ? "" : "disabled"}></div>
          <button class="btn go" type="submit" ${writable ? "" : "disabled"}>Registrar movimiento</button>
        </form>
      </section>
      <section class="card" aria-label="Libro de movimientos">
        <div class="card-head">
          <h2>Libro de movimientos</h2>
          <select class="input" id="mv-filter" style="width:auto;margin-left:auto" aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            ${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${movState.type === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Recorrido</th><th class="r">Cant.</th><th>Referencia</th><th>Registró</th></tr></thead>
          <tbody id="ledger"></tbody>
        </table></div>
        <div class="pager" id="pager"></div>
      </section>
    </div>`;

  const form = document.getElementById("mv-form");
  const sync = async () => {
    const type = form.type.value;
    const needsFrom = type === "OUT" || type === "TRANSFER";
    const needsTo = type !== "OUT";
    document.getElementById("fld-from").hidden = !needsFrom;
    document.getElementById("fld-to").hidden = !needsTo;
    document.querySelector("#fld-to label").textContent = type === "ADJUST" ? "Bodega contada" : type === "IN" ? "Entra a" : "Hacia";
    document.getElementById("mv-qty").min = type === "ADJUST" ? "" : "1";
    const p = await api.product(document.getElementById("mv-product").value);
    const at = (id) => p.byWarehouse.find((w) => w.id === Number(id))?.quantity ?? 0;
    const whId = needsFrom ? document.getElementById("mv-from").value : document.getElementById("mv-to").value;
    const whName = state.warehouses.find((w) => w.id === Number(whId))?.name;
    document.getElementById("avail").innerHTML = `Hay <b class="num">${fmtInt.format(at(whId))}</b> ${esc(plural(at(whId), p.unit))} en ${esc(whName)} · <b class="num">${fmtInt.format(p.stock)}</b> en total`;
  };
  form.addEventListener("change", sync);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const r = await attempt(() => api.recordMovement({
      type: form.type.value,
      productId: Number(document.getElementById("mv-product").value),
      fromWarehouseId: Number(document.getElementById("mv-from").value),
      toWarehouseId: Number(document.getElementById("mv-to").value),
      quantity: Number(document.getElementById("mv-qty").value),
      reference: document.getElementById("mv-ref").value.trim() || undefined,
      note: document.getElementById("mv-note").value.trim() || undefined,
    }), "Movimiento registrado");
    btn.disabled = false;
    if (r) {
      movState.fresh = r.id;
      movState.page = 1;
      await Promise.all([sync(), loadLedger()]);
    }
  };
  document.getElementById("mv-filter").onchange = (e) => { movState.type = e.target.value; movState.page = 1; loadLedger(); };
  await Promise.all([sync(), loadLedger()]);
}

function whSelect(id, selected, enabled) {
  return `<select class="input" id="${id}" ${enabled ? "" : "disabled"}>${state.warehouses.map((w) => `<option value="${w.id}" ${w.id === selected ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select>`;
}

async function loadLedger() {
  const { items, total, page, size } = await api.movements({ type: movState.type || undefined, page: movState.page, size: 15 });
  document.getElementById("ledger").innerHTML = items.length ? items.map((m) => `
    <tr class="${m.id === movState.fresh ? "fresh" : ""}">
      <td class="num" style="white-space:nowrap">${esc(when(m.createdAt))}</td>
      <td>${tag(m.type)}</td>
      <td><button class="link" data-kx="${m.product.id}">${esc(m.product.name)}</button><div class="hint">${esc(m.product.sku)}</div></td>
      <td class="route">${m.from ? esc(m.from.name) : ""}${m.from && m.to ? " → " : ""}${m.to ? esc(m.to.name) : ""}</td>
      <td class="r"><b>${fmtInt.format(m.quantity)}</b></td>
      <td>${esc(m.reference || "")}<div class="hint">${esc(m.note || "")}</div></td>
      <td>${esc(m.user)}</td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">No hay movimientos de este tipo.</td></tr>`;
  document.querySelectorAll("[data-kx]").forEach((b) => { b.onclick = () => { location.hash = `kardex/${b.dataset.kx}`; }; });

  const pages = Math.max(1, Math.ceil(total / size));
  const pager = document.getElementById("pager");
  pager.innerHTML = `<span class="hint">Página ${page} de ${pages} · ${fmtInt.format(total)} movimientos</span>
    <button class="btn" id="pg-prev" ${page <= 1 ? "disabled" : ""}>Anterior</button>
    <button class="btn" id="pg-next" ${page >= pages ? "disabled" : ""}>Siguiente</button>`;
  pager.querySelector("#pg-prev").onclick = () => { movState.page -= 1; loadLedger(); };
  pager.querySelector("#pg-next").onclick = () => { movState.page += 1; loadLedger(); };
}

// ------------------------------------------------------------------ kárdex

async function renderKardex(productId) {
  state.products = (await api.products()).items;
  const pid = Number(productId) || state.products[0]?.id;
  app.innerHTML = `
    <div class="head">
      <div><h1>Kárdex</h1><p class="sub">Historial del producto con el saldo después de cada movimiento.</p></div>
      <div class="kx-controls" style="margin-left:auto">
        <select class="input" id="kx-product" aria-label="Producto">${state.products.map((p) => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.sku)} · ${esc(p.name)}</option>`).join("")}</select>
        <select class="input" id="kx-wh" aria-label="Bodega"><option value="">Todas las bodegas</option>${state.warehouses.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select>
      </div>
    </div>
    <section class="card">
      <div class="pad" id="kx-chart"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Recorrido</th><th>Referencia</th><th class="r">Movimiento</th><th class="r">Saldo</th></tr></thead>
        <tbody id="kx-rows"></tbody>
      </table></div>
    </section>`;
  const load = async () => {
    const id = document.getElementById("kx-product").value;
    const wh = document.getElementById("kx-wh").value;
    history.replaceState(null, "", `#kardex/${id}`);
    const k = await attempt(() => api.kardex(id, wh || undefined));
    if (!k) return;
    const p = state.products.find((x) => x.id === Number(id));
    document.getElementById("kx-chart").innerHTML = balanceChart(k.entries, p.minStock, !wh);
    const rows = [...k.entries].reverse();
    document.getElementById("kx-rows").innerHTML = rows.length ? rows.map((e) => `
      <tr><td class="num" style="white-space:nowrap">${esc(when(e.createdAt))}</td><td>${tag(e.type)}</td>
        <td class="route">${e.from ? esc(e.from.name) : ""}${e.from && e.to ? " → " : ""}${e.to ? esc(e.to.name) : ""}</td>
        <td>${esc(e.reference || "")}<div class="hint">${esc(e.note || "")}</div></td>
        <td class="r ${e.delta > 0 ? "delta-pos" : e.delta < 0 ? "delta-neg" : "delta-zero"}">${e.delta > 0 ? "+" : ""}${e.delta === 0 ? "0 (traslado)" : fmtInt.format(e.delta)}</td>
        <td class="r"><b>${fmtInt.format(e.balance)}</b></td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">Este producto no tiene movimientos en esa bodega.</td></tr>`;
  };
  document.getElementById("kx-product").onchange = load;
  document.getElementById("kx-wh").onchange = load;
  await load();
}

function balanceChart(entries, minStock, showMin) {
  if (!entries.length) return "";
  const W = 1000;
  const H = 140;
  const max = Math.max(1, ...entries.map((e) => e.balance), showMin ? minStock : 0) * 1.1;
  const x = (i) => (entries.length === 1 ? W / 2 : (i / (entries.length - 1)) * (W - 20) + 10);
  const y = (v) => H - 14 - (v / max) * (H - 30);
  let d = `M ${x(0)} ${y(entries[0].balance)}`;
  entries.forEach((e, i) => { if (i > 0) d += ` H ${x(i)} V ${y(e.balance)}`; });
  const last = entries[entries.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:140px" role="img" aria-label="Saldo del producto a lo largo del tiempo">
    ${showMin ? `<line x1="0" x2="${W}" y1="${y(minStock)}" y2="${y(minStock)}" stroke="#F2B705" stroke-width="2" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${d}" fill="none" stroke="#232A33" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>
  <p class="hint">Saldo actual <b class="num">${fmtInt.format(last.balance)}</b>${showMin ? ` · la línea amarilla es el mínimo (${fmtInt.format(minStock)})` : ""} · ${entries.length} movimientos</p>`;
}

boot();
