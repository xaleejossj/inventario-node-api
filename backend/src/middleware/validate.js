const { AppError } = require("../errors");

/**
 * Valida req.body, req.query o req.params con un esquema de Zod.
 * Reemplaza el objeto por la versión validada (con tipos convertidos).
 */
const validate = (schema, source = "body") => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || source;
      errors[key] ??= issue.message;
    }
    return next(new AppError(400, "Datos inválidos", "Revisa los campos marcados", { errors }));
  }
  // req.query es de solo lectura en Express 5; en Express 4 se puede reasignar.
  if (source === "query") {
    req.validQuery = result.data;
  } else {
    req[source] = result.data;
  }
  return next();
};

module.exports = { validate };
