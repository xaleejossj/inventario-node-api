const jwt = require("jsonwebtoken");
const config = require("../config");
const { AppError } = require("../errors");

/** Exige un token JWT válido en "Authorization: Bearer <token>". */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(new AppError(401, "No autenticado", "Falta el token de acceso"));
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    return next();
  } catch {
    return next(new AppError(401, "No autenticado", "El token es inválido o expiró"));
  }
}

/** Permite el paso solo a los roles indicados. */
const authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.role)) {
    return next(new AppError(403, "Acceso denegado", "Tu rol no tiene permiso para esta operación"));
  }
  return next();
};

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.full_name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { authenticate, authorize, signToken };
