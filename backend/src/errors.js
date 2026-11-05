/** Error con código HTTP. Lo convierte en respuesta el manejador de errores de app.js. */
class AppError extends Error {
  constructor(status, title, detail, extra = {}) {
    super(detail);
    this.status = status;
    this.title = title;
    this.extra = extra;
  }
}

const notFound = (what, id) => new AppError(404, "Recurso no encontrado", `${what} con id ${id} no existe`);
const conflict = (detail) => new AppError(409, "Conflicto", detail);
const businessRule = (detail, extra) => new AppError(422, "Regla de negocio", detail, extra);

module.exports = { AppError, notFound, conflict, businessRule };
