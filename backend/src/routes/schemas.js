const { z } = require("zod");

const id = z.coerce.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "usa el formato AAAA-MM-DD");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const login = z.object({
  email: z.string().email("correo inválido"),
  password: z.string().min(1, "es obligatoria"),
});

const productCreate = z.object({
  sku: z.string().trim().min(3, "mínimo 3 caracteres").max(30).regex(/^[A-Za-z0-9-]+$/, "solo letras, números y guiones"),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  unit: z.string().trim().min(1).max(20).default("unidad"),
  unitCost: z.coerce.number().min(0, "no puede ser negativo"),
  minStock: z.coerce.number().int().min(0, "no puede ser negativo"),
});

const productUpdate = productCreate.partial().extend({ active: z.boolean().optional() });

const productQuery = z.object({
  search: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  lowStock: bool.optional(),
  includeInactive: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

const movementCreate = z.object({
  type: z.enum(["IN", "OUT", "TRANSFER", "ADJUST"], { message: "debe ser IN, OUT, TRANSFER o ADJUST" }),
  productId: id,
  fromWarehouseId: id.optional().nullable(),
  toWarehouseId: id.optional().nullable(),
  quantity: z.coerce.number().int("debe ser un número entero"),
  unitCost: z.coerce.number().min(0).optional(),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(255).optional(),
});

const movementQuery = z.object({
  productId: id.optional(),
  warehouseId: id.optional(),
  type: z.enum(["IN", "OUT", "TRANSFER", "ADJUST"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(25),
});

const kardexQuery = z.object({ warehouseId: id.optional() });

const idParam = z.object({ id });

module.exports = { login, productCreate, productUpdate, productQuery, movementCreate, movementQuery, kardexQuery, idParam };
