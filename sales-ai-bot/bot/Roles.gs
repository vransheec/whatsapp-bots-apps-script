// ============================================================
// ROLES SEMÁNTICOS DE LOS PASOS DEL FLUJO
// El rol define el PROPÓSITO de un paso, independiente de su nombre.
// El motor actúa según el rol, no según el nombre del estado, para que
// el flujo sea 100% editable/renombrable desde el panel.
//
// IMPORTANTE: inferirRolPaso debe mantenerse IDÉNTICA a la del FRONT (Main.gs),
// para que el bot y el panel infieran el mismo rol en pasos legacy sin rol.
// ============================================================

// Roles conocidos (para referencia y validación).
var ROLES = {
  SALUDO:             "saludo",              // punto de entrada / reinicio + elegir tecnología
  PIDE_PROVIDER:      "pide_provider",       // elegir proveedor (AWS/Azure/GCP...)
  PIDE_CERTIFICACION: "pide_certificacion",  // elegir certificación (según proveedor)
  PIDE_URGENCIA:      "pide_urgencia",       // preguntar urgencia/tiempo
  AGENDA:             "agenda",              // enviar el formulario de agendamiento
  AGENDADO:           "agendado",            // ya agendó
  CIERRE:             "cierre",              // estado final positivo
  REMARKETING:        "remarketing",         // no respondió
  NORMAL:             "normal"               // paso genérico
};

/**
 * Infiere el rol de un paso a partir del nombre de estado legacy.
 * Solo se usa para pasos que aún no tienen rol explícito (retrocompatibilidad).
 * DEBE ser idéntica a inferirRolPaso() del FRONT.
 */
function inferirRolPaso(estado) {
  var e = (estado || "").toString().toUpperCase();
  var mapa = {
    "INICIO":              "saludo",
    "NO_E_NUBE":           "pide_provider",
    "NO_E_CERT":           "pide_certificacion",
    "NO_E_URGENCIA":       "pide_urgencia",
    "NO_CONFIRMO_MEET":    "agenda",
    "CONFIRMO_MEET":       "agendado",
    "RECONFIRMO_MEET":     "cierre",
    "REMARKETING_FALLIDO": "remarketing"
  };
  return mapa[e] || "normal";
}

/**
 * Devuelve el rol efectivo de un paso (explícito o inferido).
 */
function rolDePaso(paso) {
  if (!paso) return "normal";
  return paso.rol || inferirRolPaso(paso.estado);
}

/**
 * Busca el PRIMER paso ACTIVO del flujo que tenga un rol dado.
 * @param {Array} flujo  lista de pasos (de cargarFlujoBot)
 * @param {string} rol   rol buscado (ej. "saludo", "agenda")
 * @returns {Object|null} el paso, o null si no existe
 */
function buscarPasoPorRol(flujo, rol) {
  if (!flujo || !flujo.length) return null;
  for (var i = 0; i < flujo.length; i++) {
    var p = flujo[i];
    if (p && p.activo !== false && rolDePaso(p) === rol) return p;
  }
  return null;
}

/**
 * Devuelve el estado (nombre) del primer paso activo con ese rol, o null.
 * Útil para asignar lead.estado sin hardcodear el nombre.
 */
function estadoDeRol(flujo, rol) {
  var p = buscarPasoPorRol(flujo, rol);
  return p ? p.estado : null;
}
