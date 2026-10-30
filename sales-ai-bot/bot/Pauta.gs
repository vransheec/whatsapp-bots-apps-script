// ============================================================
// ATRIBUCIÓN DE PAUTA (Click-to-WhatsApp Ads)
// Cuando un lead llega desde un anuncio de Meta, el webhook incluye
// mensaje.referral con el ID del anuncio. Guardamos esa pauta en LEADS
// para medir, por anuncio, cuántos leads avanzan en el pipeline.
//
// Columnas que se agregan a LEADS (al final, por nombre):
//   PAUTA_ID      → referral.source_id (ID del anuncio)
//   PAUTA_TITULAR → referral.headline (titular del anuncio, legible)
// Se registra SOLO la primera vez (atribución a la pauta de origen).
// ============================================================

/** Busca el índice (0-based) de una columna por nombre; si no existe, la crea al final. */
function _colIndexOrCreate(hoja, headers, nombre) {
  let idx = headers.indexOf(nombre);
  if (idx === -1) {
    idx = headers.length;
    hoja.getRange(1, idx + 1).setValue(nombre);
    headers.push(nombre);
  }
  return idx;
}

function registrarPautaLead(telefono, referral) {
  if (!referral) return;
  const sourceId = (referral.source_id || "").toString().trim();
  // headline suele traer el CTA del anuncio ("Chatea con nosotros"), no el nombre de
  // la campaña. Guardamos headline y body solo como referencia; el NOMBRE legible de
  // la pauta se gestiona en la hoja PAUTAS (ID → NOMBRE), que tú editas.
  const headline = (referral.headline || "").toString().trim();
  const body = (referral.body || "").toString().trim();
  if (!sourceId) return;

  const ss = getDataSS();

  // Registrar el ID en la hoja PAUTAS (para que le pongas nombre). No pisa nombres existentes.
  registrarPautaEnCatalogo(ss, sourceId, headline, body);

  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return;

  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const colTelf = headers.indexOf("TELF");
  if (colTelf === -1) return;

  const colPautaId  = _colIndexOrCreate(hoja, headers, "PAUTA_ID");
  const colPautaTit = _colIndexOrCreate(hoja, headers, "PAUTA_TITULAR");

  for (let i = 1; i < data.length; i++) {
    if ((data[i][colTelf] || "").toString().trim() === telefono) {
      // Solo escribir si el lead aún no tiene pauta (conservar la de origen).
      const pautaActual = (data[i][colPautaId] || "").toString().trim();
      if (!pautaActual) {
        hoja.getRange(i + 1, colPautaId + 1).setValue("'" + sourceId); // texto, evita notación científica
        // En PAUTA_TITULAR guardamos headline como referencia (puede ser el CTA).
        if (headline) hoja.getRange(i + 1, colPautaTit + 1).setValue(headline);
        logSheet("pauta", "✅ OK", "Lead " + telefono + " atribuido a pauta " + sourceId);
      }
      return;
    }
  }
  // Lead aún no existe: crear/asegurar la fila para capturar la pauta ya mismo.
  const lead = obtenerOCrearLead(ss, telefono);
  if (lead && lead.fila) {
    hoja.getRange(lead.fila, colPautaId + 1).setValue("'" + sourceId);
    if (headline) hoja.getRange(lead.fila, colPautaTit + 1).setValue(headline);
    logSheet("pauta", "✅ OK", "Lead nuevo " + telefono + " atribuido a pauta " + sourceId);
  }
}

// ============================================================
// HOJA PAUTAS — catálogo editable de ID → NOMBRE
// El bot registra cada ID nuevo (con su headline/body de referencia) y TÚ le pones
// el NOMBRE legible en la columna correspondiente. El dashboard usa ese nombre.
// Columnas: PAUTA_ID | NOMBRE | REF_HEADLINE | REF_BODY | PRIMERA_VEZ
// ============================================================
function registrarPautaEnCatalogo(ss, sourceId, headline, body) {
  let hoja = ss.getSheetByName("PAUTAS");
  if (!hoja) {
    hoja = ss.insertSheet("PAUTAS");
    hoja.appendRow(["PAUTA_ID", "NOMBRE", "REF_HEADLINE", "REF_BODY", "PRIMERA_VEZ"]);
  }
  const data = hoja.getDataRange().getValues();
  // ¿Ya existe el ID? (col A). No duplicar ni pisar el NOMBRE que tú pusiste.
  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] || "").toString().trim() === sourceId) return;
  }
  // Nuevo ID: lo agrega con NOMBRE vacío (para que tú lo llenes) + referencias.
  hoja.appendRow(["'" + sourceId, "", headline || "", body || "", new Date()]);
  logSheet("pauta", "✅ OK", "Nueva pauta registrada en catálogo PAUTAS: " + sourceId + " — ponle un NOMBRE");
}

// ============================================================
// REINGRESO POR PAUTA
// Cuando un lead que YA EXISTE vuelve a entrar por un anuncio Click-to-WhatsApp,
// no lo tratamos como lead nuevo: le enviamos un mensaje acorde a su situación y
// lo invitamos a (re)agendar.
//   - No-show: tuvo una cita que ya pasó y fue marcada NO_ASISTIO (en el panel).
//   - Ya conversó: tuvo conversación previa pero no es un no-show.
// Los dos mensajes son editables desde el panel (hoja MENSAJES):
//   MSG_REINGRESO_NOSHOW y MSG_REINGRESO_YA_CONVERSO.
// ============================================================

// Textos por defecto (respaldo si la clave no está en la hoja MENSAJES).
const REINGRESO_TEXTOS_DEFAULT = {
  MSG_REINGRESO_NOSHOW:
    "¡Hola de nuevo! 👋 Vimos que habías agendado una asesoría con nosotros pero no pudimos conectarnos. " +
    "No pasa nada 😊, reagendemos en el horario que mejor te convenga 👇",
  MSG_REINGRESO_YA_CONVERSO:
    "¡Qué bueno verte otra vez! 👋 Ya habíamos conversado antes. " +
    "Para darte toda la información y resolver tus dudas, agenda una asesoría con nosotros 👇"
};

/** Texto de reingreso: usa la hoja MENSAJES y cae al default si no está configurado. */
function textoReingreso(msgs, clave) {
  let t = msg(msgs, clave);
  if (!t || t === clave) t = REINGRESO_TEXTOS_DEFAULT[clave] || "";
  return t;
}

/** ¿El teléfono ya tiene una fila en LEADS? (se consulta ANTES de registrar la pauta). */
function _leadYaExiste(telefono) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return false;
  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const colTelf = headers.indexOf("TELF");
  if (colTelf === -1) return false;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][colTelf] || "").toString().trim() === telefono) return true;
  }
  return false;
}

/** ¿El lead tiene una cita en AGENDAMIENTOS marcada como NO_ASISTIO? (no-show). */
function _esNoShow(ss, telefono) {
  const hoja = ss.getSheetByName("AGENDAMIENTOS");
  if (!hoja) return false;
  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return false;
  const headers = data[0].map(h => h.toString().trim().toUpperCase());
  const cTel = headers.indexOf("TELF");
  const cEstado = headers.indexOf("ESTADO");
  if (cTel === -1 || cEstado === -1) return false;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][cTel] || "").toString().trim() !== telefono) continue;
    if ((data[i][cEstado] || "").toString().trim().toUpperCase() === "NO_ASISTIO") return true;
  }
  return false;
}

/**
 * Maneja el reingreso por pauta. Devuelve true si atendió el reingreso (el motor
 * del flujo debe hacer return), o false para seguir el flujo normal.
 */
function manejarReingresoPauta(ss, telefono, lead, msgs) {
  const cache = CacheService.getScriptCache();
  if (!cache.get("reingreso_" + telefono)) return false; // no vino por pauta ahora
  // Consumir la marca para no repetir el mensaje en el siguiente turno.
  cache.remove("reingreso_" + telefono);

  // Solo aplica si ya tuvo conversación previa (no es un lead recién creado).
  const yaConverso = !lead.es_nuevo &&
    (lead.estado !== ESTADO.INICIO || (lead.mejor_estado_bot && lead.mejor_estado_bot !== ESTADO.INICIO));
  if (!yaConverso) return false; // lead efectivamente nuevo → flujo normal

  // Caso 1: no-show (cita pasada marcada NO_ASISTIO). Caso 2: ya conversó.
  const clave = _esNoShow(ss, telefono) ? "MSG_REINGRESO_NOSHOW" : "MSG_REINGRESO_YA_CONVERSO";
  enviarTexto(telefono, textoReingreso(msgs, clave));

  // Ambos casos terminan ofreciendo (re)agendar vía el Flow de agendamiento.
  const enviado = enviarFlowAgendamiento(telefono, msgs);
  if (enviado) {
    actualizarLead(ss, telefono, {
      estado: "NO_CONFIRMO_MEET",
      accion: (clave === "MSG_REINGRESO_NOSHOW") ? "reingreso_noshow" : "reingreso_ya_converso"
    });
  }
  return true;
}
