// Cliente de la API real (Node.js + Express). Misma interfaz que mock-api.js.
import { ApiError } from "./mock-api.js";

const DEMO_EMAILS = { ADMIN: "admin@bodega.co", OPERATOR: "operador@bodega.co", VIEWER: "consulta@bodega.co" };

export function createHttpApi(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  let token = null;

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const firstError = data?.errors ? Object.values(data.errors)[0] : null;
      throw new ApiError(res.status, data?.title ?? "Error", firstError ? `${data.detail}: ${firstError}` : data?.detail ?? `La API respondió ${res.status}`);
    }
    return data;
  }

  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null && v !== false)).toString();

  return {
    mode: "api",
    async login(role) {
      const r = await call("POST", "/api/auth/login", { email: DEMO_EMAILS[role], password: "Demo1234*" });
      token = r.token;
      return r;
    },
    products: (f = {}) => call("GET", `/api/products?${qs({ ...f, size: 200 })}`),
    product: (id) => call("GET", `/api/products/${id}`),
    categories: () => call("GET", "/api/categories"),
    warehouses: () => call("GET", "/api/warehouses"),
    movements: (f = {}) => call("GET", `/api/movements?${qs(f)}`),
    recordMovement: (input) => call("POST", "/api/movements", input),
    kardex: (id, warehouseId) => call("GET", `/api/products/${id}/kardex?${qs({ warehouseId })}`),
    dashboard: () => call("GET", "/api/dashboard"),
    reset() {},
  };
}
