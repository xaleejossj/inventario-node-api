// Configuración centralizada a partir de variables de entorno.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  jwtSecret: env.JWT_SECRET || "bodega-demo-secret-cambiar-en-produccion",
  jwtExpiresIn: env.JWT_EXPIRES_IN || "8h",
  corsOrigins: (env.CORS_ORIGINS || "http://localhost:5500,http://127.0.0.1:5500,https://xaleejossj.github.io")
    .split(",").map((s) => s.trim()),
  db: env.DB_CLIENT === "mysql"
    ? {
      client: "mysql2",
      connection: {
        host: env.DB_HOST || "localhost",
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER || "bodega",
        password: env.DB_PASSWORD || "bodega",
        database: env.DB_NAME || "bodega",
        dateStrings: true,
      },
      pool: { min: 1, max: 10 },
    }
    : {
      // SQLite para desarrollo local sin instalar MySQL y para las pruebas.
      client: "better-sqlite3",
      connection: { filename: env.SQLITE_FILE || "./bodega.sqlite" },
      useNullAsDefault: true,
    },
};

if (env.NODE_ENV === "production" && !env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en producción");
}

module.exports = config;
