// ============================================================
// MIGRACIÓN — Ejecutar UNA VEZ para mover datos al nuevo sheet
// Después de ejecutar, eliminar este archivo del proyecto
// ============================================================

const SHEET_VIEJO_ID = "YOUR_SHEET_ID";
const SHEET_NUEVO_ID = "YOUR_SHEET_ID";

function leerHeaders() {
  const ss = SpreadsheetApp.openById(SHEET_NUEVO_ID);
  const hojas = ss.getSheets();
  hojas.forEach(h => {
    const headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    Logger.log(h.getName() + ": " + headers.join(" | "));
  });
}

function migrarTodo() {
  Logger.log("🚀 Iniciando migración...");
  
  migrarLeads();
  migrarMensajesChat();
  copiarHoja("Cursos");
  copiarHoja("Asesor", "Asesores");
  copiarHoja("Modalidades");
  copiarHoja("FAQ");
  copiarHoja("Mensajes");
  copiarHoja("Prompts");
  copiarHojaSimple("Logs");
  copiarHoja("PanelUsuarios");
  
  Logger.log("✅ Migración completada");
}

// ============================================================
// MIGRAR LEADS — reestructura DATA_LEADS → LEADS
// ============================================================
function migrarLeads() {
  Logger.log("📋 Migrando LEADS...");
  const ssViejo = SpreadsheetApp.openById(SHEET_VIEJO_ID);
  const ssNuevo = SpreadsheetApp.openById(SHEET_NUEVO_ID);
  
  const hojaVieja = ssViejo.getSheetByName("DATA_LEADS");
  if (!hojaVieja) { Logger.log("❌ Hoja DATA_LEADS no encontrada"); return; }
  
  // Crear hoja LEADS en el nuevo sheet
  let hojaNueva = ssNuevo.getSheetByName("LEADS");
  if (!hojaNueva) {
    hojaNueva = ssNuevo.insertSheet("LEADS");
  } else {
    hojaNueva.clear();
  }
  
  // Headers nuevos
  const headersNuevos = ["TELF", "PROVIDER", "CURSO", "ACCION_BOT", "ACCION_IA", "TURNOS_IA", "ESTADO_BOT", "MEJOR_ESTADO_BOT", "IA_ACTIVA", "CREATED_AT", "UPDATED_AT"];
  hojaNueva.appendRow(headersNuevos);
  
  // Leer data vieja
  const data = hojaVieja.getDataRange().getValues();
  const headersViejos = data[0].map(h => h.toString().trim());
  
  // Mapear columnas viejas
  const col = {};
  headersViejos.forEach((h, i) => col[h] = i);
  
  const filas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const telf = row[col["TELF"]]?.toString().trim() || "";
    if (!telf) continue;
    
    filas.push([
      telf,
      row[col["PROVIDER"]]?.toString().trim() || "",
      row[col["CURSO"]]?.toString().trim() || "",
      row[col["ACCION_BOT"]]?.toString().trim() || "",
      row[col["ACCION_IA"]]?.toString().trim() || "",
      parseInt(row[col["TURNOS_IA"]]) || 0,
      row[col["ESTADO_BOT"]]?.toString().trim() || "INICIO",
      row[col["MEJOR_ESTADO_BOT"]]?.toString().trim() || "",
      row[col["IA_ACTIVA"]]?.toString().trim() !== "0" ? 1 : 0,
      row[col["TIMESTAMP"]] || new Date(),  // CREATED_AT = primer timestamp
      row[col["TIMESTAMP"]] || new Date()   // UPDATED_AT = último timestamp
    ]);
  }
  
  if (filas.length) {
    hojaNueva.getRange(2, 1, filas.length, headersNuevos.length).setValues(filas);
  }
  
  Logger.log("✅ LEADS migrados: " + filas.length + " filas");
}

// ============================================================
// MIGRAR MENSAJES_CHAT — descompone los campos concatenados
// ============================================================
function migrarMensajesChat() {
  Logger.log("💬 Migrando MENSAJES_CHAT...");
  const ssViejo = SpreadsheetApp.openById(SHEET_VIEJO_ID);
  const ssNuevo = SpreadsheetApp.openById(SHEET_NUEVO_ID);
  
  const hojaVieja = ssViejo.getSheetByName("DATA_LEADS");
  if (!hojaVieja) { Logger.log("❌ Hoja DATA_LEADS no encontrada"); return; }
  
  // Crear hoja MENSAJES_CHAT
  let hojaNueva = ssNuevo.getSheetByName("MENSAJES_CHAT");
  if (!hojaNueva) {
    hojaNueva = ssNuevo.insertSheet("MENSAJES_CHAT");
  } else {
    hojaNueva.clear();
  }
  
  const headersNuevos = ["TIMESTAMP", "TELF", "ORIGEN", "TIPO", "CONTENIDO"];
  hojaNueva.appendRow(headersNuevos);
  
  // Leer data vieja
  const data = hojaVieja.getDataRange().getValues();
  const headersViejos = data[0].map(h => h.toString().trim());
  const col = {};
  headersViejos.forEach((h, i) => col[h] = i);
  
  const filas = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const telf = row[col["TELF"]]?.toString().trim() || "";
    if (!telf) continue;
    
    const timestamp = row[col["TIMESTAMP"]] || new Date();
    
    // Descomponer MENSAJES_CLIENTE (separados por " > ")
    const mensajesCliente = (row[col["MENSAJES_CLIENTE"]]?.toString() || "").split(" > ").filter(Boolean);
    // Descomponer RESPUESTA_IA (separados por " > ")
    const respuestasIA = (row[col["RESPUESTA_IA"]]?.toString() || "").split(" > ").filter(Boolean);
    
    // Intercalar: mensaje del lead → respuesta de la IA
    const maxLen = Math.max(mensajesCliente.length, respuestasIA.length);
    for (let j = 0; j < maxLen; j++) {
      if (mensajesCliente[j]) {
        const contenido = mensajesCliente[j].trim();
        const tipo = contenido.startsWith("btn_") || contenido.startsWith("cert_") ? "boton" : "texto";
        filas.push([timestamp, telf, "lead", tipo, contenido]);
      }
      if (respuestasIA[j]) {
        filas.push([timestamp, telf, "ia", "texto", respuestasIA[j].trim()]);
      }
    }
    
    // ULTIMO_MSG_BOT (último mensaje del bot/flujo determinístico)
    const ultimoBot = row[col["ULTIMO_MSG_BOT"]]?.toString().trim() || "";
    if (ultimoBot) {
      filas.push([timestamp, telf, "bot", "texto", ultimoBot]);
    }
  }
  
  // Escribir en lotes de 1000 para no exceder límites
  if (filas.length) {
    const batchSize = 1000;
    for (let i = 0; i < filas.length; i += batchSize) {
      const batch = filas.slice(i, i + batchSize);
      hojaNueva.getRange(hojaNueva.getLastRow() + 1, 1, batch.length, headersNuevos.length).setValues(batch);
    }
  }
  
  Logger.log("✅ MENSAJES_CHAT migrados: " + filas.length + " filas");
}

// ============================================================
// COPIAR HOJA — copia una hoja tal cual al nuevo sheet
// ============================================================
function copiarHoja(nombreViejo, nombreNuevo) {
  const nombre = nombreNuevo || nombreViejo;
  Logger.log("📄 Copiando " + nombreViejo + " → " + nombre + "...");
  
  const ssViejo = SpreadsheetApp.openById(SHEET_VIEJO_ID);
  const ssNuevo = SpreadsheetApp.openById(SHEET_NUEVO_ID);
  
  const hojaVieja = ssViejo.getSheetByName(nombreViejo);
  if (!hojaVieja) { Logger.log("⚠️ Hoja " + nombreViejo + " no encontrada, saltando"); return; }
  
  let hojaNueva = ssNuevo.getSheetByName(nombre);
  if (!hojaNueva) {
    hojaNueva = ssNuevo.insertSheet(nombre);
  } else {
    hojaNueva.clear();
  }
  
  const data = hojaVieja.getDataRange().getValues();
  if (data.length) {
    hojaNueva.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
  
  Logger.log("✅ " + nombre + " copiado: " + (data.length - 1) + " filas");
}

// Copia simple para hojas que pueden no tener data
function copiarHojaSimple(nombre) {
  copiarHoja(nombre, nombre);
}
