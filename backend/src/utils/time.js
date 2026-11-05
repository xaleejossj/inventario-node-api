// Fechas en hora local con formato "YYYY-MM-DD HH:MM:SS", igual en MySQL y SQLite.
const pad = (n) => String(n).padStart(2, "0");

const toDbDateTime = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

module.exports = { toDbDateTime };
