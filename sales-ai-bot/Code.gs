// ============================================================
// CONFIGURACIÓN — IDs de sheets y calendario
// Los valores reales viven en config.gs (excluido del repo)
// ============================================================
const CALENDAR_ID     = CONFIG.CALENDAR_ID;
const SHEET_ID        = CONFIG.SHEET_ID;
const CONFIG_SHEET_ID = CONFIG.CONFIG_SHEET_ID;

function getConfig() {
  const ss   = SpreadsheetApp.openById(CONFIG_SHEET_ID);
  const data = ss.getSheets()[0].getDataRange().getValues();
  const cfg  = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[data[i][0].toString().trim()] = data[i][1].toString().trim();
  }
  return cfg;
}

// Aliases flexibles por campo (el primero es el nombre canónico)
const FIELD_ALIASES = {
  TIMESTAMP:     ["timestamp", "fecha_registro", "created_at", "date"],
  NOMBRE:        ["nombre", "full_name", "name", "nombre_completo", "contact name"],
  TELEFONO:      ["telefono", "phone", "phone_number", "tel", "celular", "móvil", "movil"],
  CORREO:        ["correo", "email", "e-mail", "mail", "correo_electronico"],
  PAIS:          ["pais", "país", "country"],
  PROVIDER:      ["provider", "proveedor", "source_provider"],
  CURSO:         ["curso", "course", "programa", "program"],
  FUENTE:        ["fuente", "source", "utm_source"],
  CAMPANA:       ["campana", "campaña", "campaign", "utm_campaign"],
  ESTADO_BOT:    ["estado_bot", "bot_status", "bot_state"],
  ESTADO_AGENDA: ["estado_agenda", "agenda_status", "estado agenda", "status"],
  FECHA:         ["fecha", "date", "appointment_date", "fecha_cita"],
  HORA:          ["hora", "time", "appointment_time", "hora_cita"],
  ASESOR:        ["asesor", "advisor", "agent", "agente", "sales_rep"],
  MEET_LINK:     ["meet_link", "meet link", "link", "google_meet", "meeting_url"],
  ESTADO_ENVIO:  ["estado_envio", "send_status", "whatsapp_status", "envio_status"]
};

/**
 * Lee la fila de headers del sheet y devuelve un mapa { CAMPO: índice_0based }
 * usando los aliases definidos en FIELD_ALIASES.
 */
function resolverColumnas(headers) {
  const normalized = headers.map(h => h.toString().toLowerCase().trim());
  const col = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    col[field] = idx; // -1 si no se encontró
    if (idx === -1) Logger.log("⚠️ Columna no encontrada para campo: " + field);
  }

  return col;
}

// ============================================================
// TRIGGER — se instala una sola vez con instalarTrigger()
// Dispara cuando cambia el sheet (fila nueva)
// ============================================================
function onCambioLeads(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log("⏳ Otra ejecución en curso, se omite esta.");
    return;
  }

  try {
    const ss       = SpreadsheetApp.openById(SHEET_ID);
    const hoja     = ss.getSheetByName("Leads");
    const asesores = cargarAsesores(ss);

    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return;

    const data = hoja.getDataRange().getValues();
    const COL  = resolverColumnas(data[0]); // resolver headers dinámicamente

  for (let i = 1; i < data.length; i++) {
    const row          = data[i];
    const estadoAgenda = COL.ESTADO_AGENDA >= 0 ? row[COL.ESTADO_AGENDA].toString().toLowerCase().trim() : "";
    const nombre       = COL.NOMBRE   >= 0 ? row[COL.NOMBRE].toString().trim()   : "";
    const correo       = COL.CORREO   >= 0 ? row[COL.CORREO].toString().trim()   : "";
    const fecha        = COL.FECHA    >= 0 ? row[COL.FECHA]                      : null;
    const hora         = COL.HORA     >= 0 ? row[COL.HORA]                       : null;
    const provider     = COL.PROVIDER >= 0 ? row[COL.PROVIDER].toString().toUpperCase().trim() : "";

    // Solo procesar filas pendientes con datos mínimos y sin evento ya creado
    if (estadoAgenda !== "pendiente") continue;
    if (!nombre || !correo || !fecha || !hora) continue;
    if (row[COL.MEET_LINK].toString().trim() !== "") continue; // ya procesada

    const fila = i + 1; // fila real en el sheet (1-indexed)

    // 1. Asignar asesor según provider
    const asesor = asesores[provider];
    if (asesor) {
      hoja.getRange(fila, COL.ASESOR + 1).setValue(asesor.nombre);
    }

    // 2. Crear evento en Calendar
    const inicio = construirFechaHora(fecha, hora);
    if (!inicio) {
      Logger.log("⚠️ Fecha/hora inválida para: " + nombre);
      continue;
    }
    const fin = new Date(inicio.getTime() + 10 * 60 * 1000); // 10 minutos

    const invitados = [correo];
    if (asesor) invitados.push(asesor.correo);

    try {
      const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      const evento = calendar.createEvent(
        "Asesoría Comercial - " + nombre,
        inicio,
        fin,
        {
          description: "Provider: " + provider +
                       "\nCurso: "    + row[COL.CURSO] +
                       "\nPaís: "     + row[COL.PAIS] +
                       "\nTeléfono: " + row[COL.TELEFONO] +
                       "\nFuente: "   + row[COL.FUENTE],
          guests: invitados.join(","),
          sendInvites: true
        }
      );

      // Meet link puede no estar disponible de inmediato
      let meetLink = "";
      try { meetLink = evento.getHangoutLink() || ""; } catch (_) {}
      if (!meetLink) meetLink = "https://calendar.google.com/calendar/r/event?eid=" + evento.getId();

      // 3. Actualizar fila
      hoja.getRange(fila, COL.ESTADO_AGENDA + 1).setValue("creado");
      hoja.getRange(fila, COL.MEET_LINK + 1).setValue(meetLink);

      // 4. Enviar WhatsApp de confirmación
      const fechaFormato = Utilities.formatDate(inicio, Session.getScriptTimeZone(), "dd/MM/yyyy");
      const horaFormato  = Utilities.formatDate(inicio, Session.getScriptTimeZone(), "hh:mm a");
      const enviado = enviarWhatsApp(row[COL.TELEFONO], nombre, fechaFormato, horaFormato, meetLink);
      hoja.getRange(fila, COL.ESTADO_ENVIO + 1).setValue(enviado ? "enviado" : "error");

      Logger.log("✅ Evento creado: " + nombre + " | " + inicio + " | " + meetLink);
    } catch (err) {
      Logger.log("❌ Error creando evento para " + nombre + ": " + err.message);
    }
  }

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Carga la hoja "Asesores" y devuelve un mapa { PROVIDER: { nombre, correo } }
// ============================================================
function cargarAsesores(ss) {
  const hoja = ss.getSheetByName("Asesores");
  if (!hoja) return {};

  const data = hoja.getDataRange().getValues();
  const map  = {};

  for (let i = 1; i < data.length; i++) {
    const provider = data[i][0].toString().toUpperCase().trim();
    const nombre   = data[i][1].toString().trim();
    const correo   = data[i][2].toString().trim();
    if (provider && correo) {
      map[provider] = { nombre, correo };
    }
  }
  return map;
}

// ============================================================
// Construye un objeto Date combinando fecha y hora
// Acepta múltiples formatos de fecha y hora
// ============================================================
function construirFechaHora(fecha, hora) {
  try {
    const tz = Session.getScriptTimeZone();

    // --- FECHA ---
    let fechaStr;
    if (Object.prototype.toString.call(fecha) === "[object Date]" && !isNaN(fecha)) {
      fechaStr = Utilities.formatDate(fecha, tz, "yyyy-MM-dd");
    } else {
      fechaStr = normalizarFecha(fecha.toString().trim());
    }

    // --- HORA ---
    let horaStr;
    if (Object.prototype.toString.call(hora) === "[object Date]" && !isNaN(hora)) {
      horaStr = Utilities.formatDate(hora, tz, "HH:mm");
    } else {
      horaStr = normalizarHora(hora.toString().trim());
    }

    if (!fechaStr || !horaStr) return null;

    const resultado = new Date(fechaStr + "T" + horaStr + ":00");
    return isNaN(resultado) ? null : resultado;
  } catch (e) {
    Logger.log("❌ construirFechaHora error: " + e.message);
    return null;
  }
}

// Normaliza cualquier formato de fecha a yyyy-MM-dd
function normalizarFecha(str) {
  if (!str) return null;
  const anioActual = new Date().getFullYear();

  // Separadores: / - .
  const partes = str.split(/[\/\-\.]/);

  let d, m, a;

  if (partes.length === 3) {
    const p0 = parseInt(partes[0]), p1 = parseInt(partes[1]), p2 = parseInt(partes[2]);

    if (partes[0].length === 4) {
      // yyyy-MM-dd o yyyy/MM/dd
      a = p0; m = p1; d = p2;
    } else if (partes[2].length === 4 || partes[2].length === 2) {
      // dd/MM/yyyy o dd/MM/yy
      d = p0; m = p1;
      a = partes[2].length === 2 ? 2000 + p2 : p2;
    } else {
      // Ambiguo: asumir MM/dd/yyyy si p0 > 12, sino dd/MM
      if (p0 > 12) { d = p0; m = p1; } else { m = p0; d = p1; }
      a = anioActual;
    }
  } else if (partes.length === 2) {
    // Solo día y mes → año actual
    const p0 = parseInt(partes[0]), p1 = parseInt(partes[1]);
    if (p0 > 12) { d = p0; m = p1; } else { d = p0; m = p1; }
    a = anioActual;
  } else {
    return null;
  }

  if (!d || !m || !a) return null;
  return a + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

// Normaliza cualquier formato de hora a HH:mm (24h)
function normalizarHora(str) {
  if (!str) return "18:00";

  str = str.trim().toLowerCase();

  // Detectar AM/PM
  const esPM = str.includes("pm") || str.includes("p.m");
  const esAM = str.includes("am") || str.includes("a.m");
  str = str.replace(/[apm\.\s]/g, "");

  // Extraer horas y minutos
  let h, min;
  if (str.includes(":")) {
    const partes = str.split(":");
    h   = parseInt(partes[0]);
    min = parseInt(partes[1]) || 0;
  } else {
    h   = parseInt(str);
    min = 0;
  }

  if (isNaN(h)) return "18:00";

  // Convertir a 24h
  if (esPM && h < 12) h += 12;
  if (esAM && h === 12) h = 0;

  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

// ============================================================
// ENVÍO DE WHATSAPP — mensaje de confirmación de cita
// ============================================================
function enviarWhatsApp(telefono, nombre, fecha, hora, meetLink) {
  const tel = telefono.toString().replace(/\D/g, "");
  if (!tel) {
    Logger.log("⚠️ Teléfono inválido para WhatsApp: " + telefono);
    return false;
  }

  const cfg        = getConfig();
  const phoneId    = cfg["WA_PHONE_ID"];
  const token      = cfg["WA_TOKEN"];

  if (!phoneId || !token) {
    Logger.log("❌ Faltan credenciales WA_PHONE_ID o WA_TOKEN en Config sheet");
    return false;
  }

  const url = "https://graph.facebook.com/v19.0/" + phoneId + "/messages";

  const payload = {
    messaging_product: "whatsapp",
    to: tel,
    type: "template",
    template: {
      name: "asesoria_cloud",
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: nombre },
            { type: "text", text: fecha },
            { type: "text", text: hora },
            { type: "text", text: meetLink }
          ]
        }
      ]
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code     = response.getResponseCode();
    const body     = response.getContentText();

    if (code === 200) {
      Logger.log("📱 WhatsApp enviado a: " + tel);
      return true;
    } else {
      Logger.log("❌ WhatsApp error " + code + ": " + body);
      return false;
    }
  } catch (e) {
    Logger.log("❌ WhatsApp excepción: " + e.message);
    return false;
  }
}

// ============================================================
// PRUEBA MANUAL — ejecutar para diagnosticar sin trigger
// ============================================================
function probarConUltimaFila() {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const hoja = ss.getSheetByName("Leads");
  const data = hoja.getDataRange().getValues();

  const COL = resolverColumnas(data[0]); // resolver headers dinámicamente

  // Tomar la última fila con datos
  const i   = data.length - 1;
  const row = data[i];

  Logger.log("--- Datos de la fila " + (i + 1) + " ---");
  Logger.log("NOMBRE: "        + (COL.NOMBRE   >= 0 ? row[COL.NOMBRE]   : "N/A"));
  Logger.log("CORREO: "        + (COL.CORREO   >= 0 ? row[COL.CORREO]   : "N/A"));
  Logger.log("PROVIDER: "      + (COL.PROVIDER >= 0 ? row[COL.PROVIDER] : "N/A"));
  Logger.log("FECHA: "         + (COL.FECHA    >= 0 ? row[COL.FECHA]    : "N/A"));
  Logger.log("HORA: "          + (COL.HORA     >= 0 ? row[COL.HORA]     : "N/A"));
  Logger.log("ESTADO_AGENDA: " + (COL.ESTADO_AGENDA >= 0 ? row[COL.ESTADO_AGENDA] : "N/A"));

  const fechaRaw = COL.FECHA >= 0 ? row[COL.FECHA] : null;
  const horaRaw  = COL.HORA  >= 0 ? row[COL.HORA]  : null;
  Logger.log("FECHA tipo: " + Object.prototype.toString.call(fechaRaw) + " | valor: " + fechaRaw);
  Logger.log("HORA tipo: "  + Object.prototype.toString.call(horaRaw)  + " | valor: " + horaRaw);

  const inicio = construirFechaHora(fechaRaw, horaRaw);
  Logger.log("Fecha construida: " + inicio);

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  Logger.log("Calendar encontrado: " + (calendar ? calendar.getName() : "NULL"));

  if (!inicio || !calendar) {
    Logger.log("❌ Faltan datos para crear el evento");
    return;
  }

  const fin    = new Date(inicio.getTime() + 60 * 60 * 1000);
  const evento = calendar.createEvent(
    "TEST - " + (COL.NOMBRE >= 0 ? row[COL.NOMBRE] : "Sin nombre"),
    inicio,
    fin,
    { guests: COL.CORREO >= 0 ? row[COL.CORREO] : "", sendInvites: true }
  );

  let meetLink = "";
  try { meetLink = evento.getHangoutLink() || ""; } catch (_) {}
  if (!meetLink) meetLink = "https://calendar.google.com/calendar/r/event?eid=" + evento.getId();

  Logger.log("✅ Evento creado: " + meetLink);

  // Actualizar fila
  if (COL.ESTADO_AGENDA >= 0) hoja.getRange(i + 1, COL.ESTADO_AGENDA + 1).setValue("creado");
  if (COL.MEET_LINK     >= 0) hoja.getRange(i + 1, COL.MEET_LINK     + 1).setValue(meetLink);
}

// ============================================================
// SETUP — ejecutar UNA SOLA VEZ para instalar el trigger
// ============================================================
function instalarTrigger() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Eliminar triggers previos para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "onCambioLeads") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("onCambioLeads")
    .forSpreadsheet(ss)
    .onChange()
    .create();

  Logger.log("✅ Trigger onChange instalado sobre sheet Leads");
}
