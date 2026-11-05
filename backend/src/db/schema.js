// Esquema de la base de datos. Funciona igual en MySQL y en SQLite gracias a Knex.

async function migrate(db) {
  if (!(await db.schema.hasTable("users"))) {
    await db.schema.createTable("users", (t) => {
      t.increments("id");
      t.string("full_name", 120).notNullable();
      t.string("email", 160).notNullable().unique();
      t.string("password_hash", 100).notNullable();
      t.enu("role", ["ADMIN", "OPERATOR", "VIEWER"]).notNullable();
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable("warehouses"))) {
    await db.schema.createTable("warehouses", (t) => {
      t.increments("id");
      t.string("code", 12).notNullable().unique();
      t.string("name", 80).notNullable();
      t.string("city", 60);
      t.boolean("active").notNullable().defaultTo(true);
    });
  }

  if (!(await db.schema.hasTable("products"))) {
    await db.schema.createTable("products", (t) => {
      t.increments("id");
      t.string("sku", 30).notNullable().unique();
      t.string("name", 120).notNullable();
      t.string("category", 60).notNullable();
      t.string("unit", 20).notNullable().defaultTo("unidad");
      t.decimal("unit_cost", 14, 2).notNullable().defaultTo(0);
      t.integer("min_stock").notNullable().defaultTo(0);
      t.boolean("active").notNullable().defaultTo(true);
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
      t.index(["category"]);
    });
  }

  // Existencias por producto y bodega. Se actualizan solo a través de movimientos.
  if (!(await db.schema.hasTable("stock_levels"))) {
    await db.schema.createTable("stock_levels", (t) => {
      t.integer("product_id").unsigned().notNullable().references("products.id");
      t.integer("warehouse_id").unsigned().notNullable().references("warehouses.id");
      t.integer("quantity").notNullable().defaultTo(0);
      t.primary(["product_id", "warehouse_id"]);
    });
  }

  // Libro de movimientos: inmutable, es la fuente de verdad del kárdex.
  if (!(await db.schema.hasTable("movements"))) {
    await db.schema.createTable("movements", (t) => {
      t.increments("id");
      t.enu("type", ["IN", "OUT", "TRANSFER", "ADJUST"]).notNullable();
      t.integer("product_id").unsigned().notNullable().references("products.id");
      t.integer("from_warehouse_id").unsigned().references("warehouses.id");
      t.integer("to_warehouse_id").unsigned().references("warehouses.id");
      t.integer("quantity").notNullable();
      t.decimal("unit_cost", 14, 2).notNullable().defaultTo(0);
      t.string("reference", 60);
      t.string("note", 255);
      t.integer("user_id").unsigned().notNullable().references("users.id");
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      t.index(["product_id", "created_at"]);
      t.index(["created_at"]);
    });
  }

  // Auditoría de cambios en el catálogo (valor anterior y nuevo).
  if (!(await db.schema.hasTable("audit_log"))) {
    await db.schema.createTable("audit_log", (t) => {
      t.increments("id");
      t.string("entity", 40).notNullable();
      t.integer("entity_id").notNullable();
      t.string("action", 20).notNullable();
      t.text("before_json");
      t.text("after_json");
      t.integer("user_id").unsigned().references("users.id");
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      t.index(["entity", "entity_id"]);
    });
  }
}

module.exports = { migrate };
