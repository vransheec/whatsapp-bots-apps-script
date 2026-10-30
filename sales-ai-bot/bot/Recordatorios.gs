// ============================================================
// RECORDATORIOS DE ASESORÍA (anti no-show)
// Trigger horario que revisa la hoja AGENDAMIENTOS y envía, SOLO dentro de la
// ventana de 24h de WhatsApp:
//   1) ~1 día antes: pide confirmar (botones Confirmar / No podré).
//   2) El mismo día:
//        - si confirmó  → recordatorio + link de la Meet.
//        - si no confirmó → vuelve a pedir que confirme.
// Fuera de ventana no se envía nada (requeriría plantilla de Meta); esos casos
// quedan registrados para el reporte diario (Fase 4).
//
// Columnas de control que este motor crea on-demand en AGENDAMIENTOS:
//   MEET_LINK                → link de la videollamada
//   CONFIRMADA               → "SI" cuando el cliente confirma asistencia
//   RECORD_CONFIRM_ENVIADO   → timestamp del recordatorio de confirmación (1 día antes)
//   RECORD_DIA_ENVIADO       → timestamp del recordatorio del día
//   RECORD_NO_VENTANA        → motivo si no se pudo enviar (fuera de ventana 24h)
// ============================================================

// Textos por defecto (editables desde el panel → claves MSG_RECORD_* en hoja MENSAJES).
const RECORD_TEXTOS_DEFAULT = {
  MSG_RECORD_CONFIRMAR:
    "¡Hola! 👋 Te recordamos tu asesoría de Cloud Academy para mañana:\n\n📅 {fecha}\n\n¿Podrás asistir? Confírmanos para reservarte el cupo 👇",
  MSG_RECORD_DIA_CONFIRMADO:
    "¡Hoy es tu asesoría! 🎉\n\n📅 {fecha}\n\n🔗 Únete por aquí a la hora acordada:\n{link}\n\n¡Te esperamos!",
  MSG_RECORD_DIA_SIN_CONFIRMAR:
    "¡Hola! Hoy tienes tu asesoría de Cloud Academy:\n\n📅 {fecha}\n\nAún no nos confirmaste. ¿Podrás asistir? Confírmanos 👇",
  MSG_RECORD_BTN_CONFIRMAR: "✅ Sí, asistiré",
  MSG_RECORD_BTN_NO_PODRE:  "❌ No podré",
  MSG_RECORD_CONFIRMADO_OK:
    "¡Genial! 🙌 Tu asistencia quedó confirmada. El día de la sesión te enviaremos el enlace para unirte.",
  MSG_RECORD_NO_PODRE:
    "No hay problema 😊. Reagendemos para la fecha que mejor te convenga 👇"
};

// Link de respaldo (para citas antiguas sin Meet propio). Editable desde el panel
// como clave MSG_RECORD_LINK_RESPALDO en la hoja MENSAJES. Vacío = sin respaldo.
function _linkMeetRespaldo(msgs) {
  const v = msg(msgs, "MSG_RECORD_LINK_RESPALDO");
  return (!v || v === "MSG_RECORD_LINK_RESPALDO") ? "" : v;
}

/** Texto de recordatorio: hoja MENSAJES con fallback al default. */
function textoRecord(msgs, clave) {
  let t = msg(msgs, clave);
  if (!t || t === clave) t = RECORD_TEXTOS_DEFAULT[clave] || "";
  return t;
}

// ── Índices de columnas de AGENDAMIENTOS (se aseguran al vuelo) ──
function _agColIndex(hoja, headers, nombre) {
  let idx = headers.indexOf(nombre);
  if (idx === -1) { idx = headers.length; hoja.getRange(1, idx + 1).setValue(nombre); headers.push(nombre); }
  return idx;
}

// ============================================================
// MOTOR PRINCIPAL — instalar como trigger horario (ver instalarRecordatoriosWhatsApp)
// ============================================================
function procesarRecordatorios() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("AGENDAMIENTOS");
  if (!hoja) { logSheet("record", "ℹ️ INFO", "No existe AGENDAMIENTOS"); return; }

  const msgs = cargarMensajes(ss);
  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map(h => h.toString().trim().toUpperCase());
  const cTel     = headers.indexOf("TELF");
  const cFecha   = headers.indexOf("FECHA_HORA");
  const cEstado  = headers.indexOf("ESTADO");
  const cMeet    = _agColIndex(hoja, headers, "MEET_LINK");
  const cConf    = _agColIndex(hoja, headers, "CONFIRMADA");
  const cRecConf = _agColIndex(hoja, headers, "RECORD_CONFIRM_ENVIADO");
  const cRecDia  = _agColIndex(hoja, headers, "RECORD_DIA_ENVIADO");
  const cNoVent  = _agColIndex(hoja, headers, "RECORD_NO_VENTANA");
  if (cTel === -1 || cFecha === -1) { logSheet("record", "⚠️ WARNING", "Faltan columnas TELF/FECHA_HORA"); return; }

  const ahora = new Date();
  let enviados = 0;

  for (let i = 1; i < data.length; i++) {
    const telf = (data[i][cTel] || "").toString().trim();
    const fechaRaw = data[i][cFecha];
    if (!telf || !fechaRaw) continue;

    const inicio = new Date(fechaRaw);
    if (isNaN(inicio.getTime())) continue;

    const estado = (cEstado >= 0 ? (data[i][cEstado] || "").toString().trim().toUpperCase() : "");
    // No recordar citas ya cerradas (asistió / no asistió / convertido / cancelada).
    if (["ASISTIO", "NO_ASISTIO", "CONVERTIDO", "CANCELADA"].indexOf(estado) !== -1) continue;

    const fila = i + 1;
    const msHastaCita = inicio.getTime() - ahora.getTime();
    const horasHastaCita = msHastaCita / 3600000;
    const confirmada = (data[i][cConf] || "").toString().trim().toUpperCase() === "SI";
    const yaConfirmEnv = !!(data[i][cRecConf] || "").toString().trim();
    const yaDiaEnv     = !!(data[i][cRecDia]  || "").toString().trim();

    // ── ¿Es el día de la cita? (mismo día calendario, cita aún no empezó o es hoy) ──
    const esMismoDia = _mismaFecha(inicio, ahora, AGENDA_TZ);

    try {
      // 1) RECORDATORIO DEL DÍA (prioridad sobre el de confirmación)
      if (esMismoDia && msHastaCita > 0 && !yaDiaEnv) {
        if (!_dentroVentana24h(ss, telf)) {
          hoja.getRange(fila, cNoVent + 1).setValue("dia:fuera_ventana " + Utilities.formatDate(ahora, AGENDA_TZ, "yyyy-MM-dd HH:mm"));
          continue;
        }
        const fechaLegible = formatearSlotLegible(inicio);
        if (confirmada) {
          let link = (data[i][cMeet] || "").toString().trim() || _linkMeetRespaldo(msgs);
          let t = textoRecord(msgs, "MSG_RECORD_DIA_CONFIRMADO")
                    .replace(/\{fecha\}/g, fechaLegible)
                    .replace(/\{link\}/g, link || "(te compartiremos el enlace en breve)");
          enviarTexto(telf, t);
        } else {
          // No confirmó: volver a pedir confirmación (con botones).
          const t = textoRecord(msgs, "MSG_RECORD_DIA_SIN_CONFIRMAR").replace(/\{fecha\}/g, fechaLegible);
          _enviarBotonesConfirmacion(telf, t, msgs);
        }
        hoja.getRange(fila, cRecDia + 1).setValue(ahora);
        enviados++;
        Utilities.sleep(400);
        continue;
      }

      // 2) RECORDATORIO DE CONFIRMACIÓN (~1 día antes: entre 23h y 25h de la cita)
      if (!esMismoDia && horasHastaCita >= 23 && horasHastaCita <= 25 && !yaConfirmEnv) {
        if (!_dentroVentana24h(ss, telf)) {
          hoja.getRange(fila, cNoVent + 1).setValue("confirm:fuera_ventana " + Utilities.formatDate(ahora, AGENDA_TZ, "yyyy-MM-dd HH:mm"));
          continue;
        }
        const fechaLegible = formatearSlotLegible(inicio);
        const t = textoRecord(msgs, "MSG_RECORD_CONFIRMAR").replace(/\{fecha\}/g, fechaLegible);
        _enviarBotonesConfirmacion(telf, t, msgs);
        hoja.getRange(fila, cRecConf + 1).setValue(ahora);
        enviados++;
        Utilities.sleep(400);
        continue;
      }
    } catch (e) {
      logSheet("record", "❌ ERROR", "Fila " + fila + " (" + telf + "): " + e.message);
    }
  }

  logSheet("record", "✅ OK", "Recordatorios enviados: " + enviados);
}

// Envía un mensaje con los dos botones de confirmación de asistencia.
function _enviarBotonesConfirmacion(telefono, texto, msgs) {
  enviarMensajeWA({
    messaging_product: "whatsapp", to: telefono, type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: { buttons: [
        btn("btn_record_confirmar", textoRecord(msgs, "MSG_RECORD_BTN_CONFIRMAR")),
        btn("btn_record_no_podre",  textoRecord(msgs, "MSG_RECORD_BTN_NO_PODRE"))
      ] }
    }
  });
}

// ¿El cliente está dentro de la ventana de 24h de WhatsApp? (último mensaje
// entrante del lead hace menos de 24h). Lee MENSAJES_CHAT.
function _dentroVentana24h(ss, telefono) {
  const hoja = ss.getSheetByName("MENSAJES_CHAT");
  if (!hoja) return false;
  const data = hoja.getDataRange().getValues();
  // Columnas: TIMESTAMP | TELF | ORIGEN | TIPO | CONTENIDO
  let ultimoLead = null;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1] || "").toString().trim() !== telefono) continue;
    const origen = (data[i][2] || "").toString().trim().toLowerCase();
    if (origen === "lead") {
      const t = new Date(data[i][0]);
      if (!isNaN(t.getTime())) ultimoLead = t;
    }
  }
  if (!ultimoLead) return false;
  return (Date.now() - ultimoLead.getTime()) < 24 * 3600000;
}

// ¿Dos fechas caen en el mismo día calendario en la zona horaria dada?
function _mismaFecha(a, b, tz) {
  const fa = Utilities.formatDate(a, tz, "yyyy-MM-dd");
  const fb = Utilities.formatDate(b, tz, "yyyy-MM-dd");
  return fa === fb;
}

// ============================================================
// Respuestas del cliente a los botones de recordatorio.
// Se llama desde procesarMensajeFlujoNuevo (Bot.gs).
// Devuelve true si manejó el payload.
// ============================================================
function manejarRespuestaRecordatorio(ss, telefono, payload, msgs) {
  if (payload === "btn_record_confirmar") {
    _marcarConfirmada(ss, telefono, true);
    enviarTexto(telefono, textoRecord(msgs, "MSG_RECORD_CONFIRMADO_OK"));
    return true;
  }
  if (payload === "btn_record_no_podre") {
    _marcarConfirmada(ss, telefono, false);
    enviarTexto(telefono, textoRecord(msgs, "MSG_RECORD_NO_PODRE"));
    // Ofrecer reagendar con el Flow.
    enviarFlowAgendamiento(telefono, msgs);
    return true;
  }
  return false;
}

// Marca CONFIRMADA (SI/NO) en la fila más reciente del teléfono en AGENDAMIENTOS.
// Si dice que no podrá, además marca ESTADO = CANCELADA para no seguir recordando.
function _marcarConfirmada(ss, telefono, confirma) {
  const hoja = ss.getSheetByName("AGENDAMIENTOS");
  if (!hoja) return;
  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim().toUpperCase());
  const cTel = headers.indexOf("TELF");
  if (cTel === -1) return;
  const cConf   = _agColIndex(hoja, headers, "CONFIRMADA");
  const cEstado = headers.indexOf("ESTADO");

  let filaObj = -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][cTel] || "").toString().trim() === telefono) filaObj = i + 1;
  }
  if (filaObj < 0) return;
  hoja.getRange(filaObj, cConf + 1).setValue(confirma ? "SI" : "NO");
  if (!confirma && cEstado >= 0) hoja.getRange(filaObj, cEstado + 1).setValue("CANCELADA");
}

// ============================================================
// Instalar el trigger horario de los recordatorios por WhatsApp.
// ⚠️ ESTA es la función a ejecutar (NO "enviarRecordatorios" ni
//    "instalarTriggerRecordatorio", que son los del correo). Ejecutar UNA vez.
// ============================================================
function instalarRecordatoriosWhatsApp() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "procesarRecordatorios") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("procesarRecordatorios").timeBased().everyHours(1).create();
  Logger.log("✅ Recordatorios por WhatsApp: trigger horario instalado (cada 1 hora). Función del motor: procesarRecordatorios.");
}
