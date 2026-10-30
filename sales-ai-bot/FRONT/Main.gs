// ============================================================
// PANEL DE ADMINISTRACIÓN — Bot IA Ventas
// Proyecto separado del bot, comparte el mismo Google Sheet
// ============================================================

const DATA_SHEET_ID = PropertiesService.getScriptProperties().getProperty("DATA_SHEET_ID");

function getDataSS() {
  return SpreadsheetApp.openById(DATA_SHEET_ID);
}

// ============================================================
// SERVIR PÁGINAS HTML
// ============================================================
function doGet(e) {
  // Verificar acceso del usuario autenticado
  const usuario = obtenerUsuarioActual();
  
  if (!usuario.success) {
    // No tiene acceso → mostrar página de error
    const template = HtmlService.createTemplateFromFile("sin_acceso");
    template.error = usuario.error;
    return template.evaluate()
      .setTitle("Sin acceso — Cloud Academy Bot")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  // Tiene acceso → mostrar la página solicitada (solo páginas válidas)
  const PAGINAS_VALIDAS = ["dashboard", "mensajes", "chat", "prompt", "catalogo", "flujo", "agendamiento", "kanban"];
  const pageParam = e?.parameter?.page || "dashboard";
  const page = PAGINAS_VALIDAS.includes(pageParam) ? pageParam : "dashboard";
  const template = HtmlService.createTemplateFromFile(page);
  return template.evaluate()
    .setTitle("Panel Admin — Cloud Academy Bot")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// Incluir archivos parciales (CSS, JS compartido)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Obtener la URL base del Web App para navegación
function getBaseUrl() {
  return ScriptApp.getService().getUrl();
}

// ============================================================
// AUTH — Usa la sesión de Google de Apps Script + lista de permitidos
// ============================================================
function getClientId() {
  return ""; // No se usa, mantenido por compatibilidad
}

function obtenerUsuarioActual() {
  // Intentar con getActiveUser primero (funciona dentro del mismo dominio Workspace)
  let email = Session.getActiveUser().getEmail();
  
  // Fallback: getEffectiveUser (funciona cuando el script se ejecuta como el owner)
  if (!email) {
    email = Session.getEffectiveUser().getEmail();
  }

  if (!email) return { success: false, error: "No se pudo obtener tu email de Google" };

  // Verificar que el email está en la lista de permitidos
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PANELUSUARIO");
  if (!hoja) return { success: false, error: "Hoja PANELUSUARIO no existe" };

  const data = hoja.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim().toLowerCase() === email.toLowerCase()) {
      return { success: true, email: email, rol: data[i][1] || "admin", nombre: data[i][2] || email };
    }
  }

  // Verificar dominio @example.com aunque no esté en la lista explícita
  if (email.toLowerCase().endsWith("@example.com")) {
    return { success: true, email: email, rol: "asesor", nombre: email };
  }

  return { success: false, error: "No tienes acceso al panel (" + email + "). Contacta al administrador." };
}

function verificarSesion(token) {
  // Ya no se usa token — se valida directo con Session
  return obtenerUsuarioActual();
}

// ============================================================
// API — LEADS (con filtros)
// ============================================================
function getLeads(filtros) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const headers = data[0];
  const result = [];

  // Fechas: default últimos 3 días
  const ahora = new Date();
  const hace3dias = new Date(ahora.getTime() - 3 * 24 * 60 * 60 * 1000);
  const desde = filtros?.desde ? new Date(filtros.desde) : hace3dias;
  const hasta = filtros?.hasta ? new Date(filtros.hasta + "T23:59:59") : ahora;

  // Mapa teléfono → último mensaje (desde MENSAJES_CHAT), una sola lectura.
  const ultimos = obtenerUltimosMensajesPorLead();

  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, j) => row[h] = data[i][j]?.toString() || "");

    // Filtro por fecha — usa UPDATED_AT (col 1) o CREATED_AT (col 0) según orden
    const colFecha = filtros?.orden === 'primera' ? 0 : 1;
    const ts = new Date(data[i][colFecha]);
    if (isNaN(ts.getTime()) || ts < desde || ts > hasta) continue;

    // Filtro por provider
    if (filtros?.provider && filtros.provider !== "TODOS") {
      if ((row.PROVIDER || "").toUpperCase() !== filtros.provider.toUpperCase()) continue;
    }

    // Adjuntar el último mensaje real de la conversación (para el preview del chat)
    const ult = ultimos[(row.TELF || "").trim()];
    if (ult) {
      row.ULTIMO_MSG        = ult.contenido;
      row.ULTIMO_MSG_ORIGEN = ult.origen;
      row.ULTIMO_MSG_TS     = ult.timestamp;
    } else {
      row.ULTIMO_MSG        = "";
      row.ULTIMO_MSG_ORIGEN = "";
      row.ULTIMO_MSG_TS     = "";
    }

    result.push(row);
  }
  return result;
}

/**
 * Recorre MENSAJES_CHAT una sola vez y devuelve un mapa
 * { telefono: { contenido, origen, timestamp } } con el ÚLTIMO mensaje de cada lead.
 * Columnas de MENSAJES_CHAT: TIMESTAMP | TELF | ORIGEN | TIPO | CONTENIDO
 */
function obtenerUltimosMensajesPorLead() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES_CHAT");
  const mapa = {};
  if (!hoja) return mapa;

  const data = hoja.getDataRange().getValues();
  // Recorremos en orden; como los mensajes se agregan cronológicamente (append),
  // la última fila de cada teléfono es su mensaje más reciente.
  for (let i = 1; i < data.length; i++) {
    const telf = (data[i][1] || "").toString().trim();
    if (!telf) continue;
    mapa[telf] = {
      timestamp: data[i][0] ? new Date(data[i][0]).getTime() : 0,
      origen:    (data[i][2] || "").toString().trim(),
      contenido: (data[i][4] || "").toString()
    };
  }
  return mapa;
}

// Obtener tecnologías y providers para los filtros encadenados
function getTecnologiasYProviders() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("ASESORES");
  if (!hoja) return { tecnologias: [], providers: [] };

  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toUpperCase().trim());
  // Usa TECNOLOGIA_ID (esquema nuevo); si no existe, cae a TECNOLOGIA (esquema viejo).
  let colTech = headers.indexOf("TECNOLOGIA_ID");
  if (colTech === -1) colTech = headers.indexOf("TECNOLOGIA");
  const colProv = headers.indexOf("PROVIDER");

  const mapa = {}; // { CLOUD: [AWS, AZURE, GCP], IA: [IA] }
  for (let i = 1; i < data.length; i++) {
    const tech = (data[i][colTech] || "").toString().trim().replace(/[^\w]/g, "").toUpperCase();
    const prov = (data[i][colProv] || "").toString().trim().toUpperCase();
    if (!tech || !prov) continue;
    if (!mapa[tech]) mapa[tech] = [];
    if (!mapa[tech].includes(prov)) mapa[tech].push(prov);
  }

  return mapa;
}

// Toggle IA por lead
function toggleIALead(telefono, activa) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false };

  const data = hoja.getDataRange().getValues();
  const headers = data[0];
  const colTelf = headers.indexOf("TELF");
  const colIA = headers.indexOf("IA_ACTIVA");

  for (let i = 1; i < data.length; i++) {
    if (data[i][colTelf]?.toString().trim() === telefono) {
      hoja.getRange(i + 1, colIA + 1).setValue(activa ? 1 : 0);
      return { success: true };
    }
  }
  return { success: false };
}

// Toggle Bot (flujo determinístico) por lead
function toggleBotLead(telefono, activo) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false };

  const data = hoja.getDataRange().getValues();
  const headers = data[0];
  const colTelf = headers.indexOf("TELF");
  const colBot = headers.indexOf("BOT_ACTIVO");

  // Si la columna no existe aún, crearla
  if (colBot === -1) {
    const lastCol = headers.length + 1;
    hoja.getRange(1, lastCol).setValue("BOT_ACTIVO");
    for (let i = 1; i < data.length; i++) {
      if (data[i][colTelf]?.toString().trim() === telefono) {
        hoja.getRange(i + 1, lastCol).setValue(activo ? 1 : 0);
        return { success: true };
      }
    }
    return { success: false };
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][colTelf]?.toString().trim() === telefono) {
      hoja.getRange(i + 1, colBot + 1).setValue(activo ? 1 : 0);
      return { success: true };
    }
  }
  return { success: false };
}

// ============================================================
// API — MENSAJES (CRUD)
// ============================================================
function getMensajes() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      result.push({ fila: i + 1, clave: data[i][0].toString(), texto: data[i][1]?.toString() || "" });
    }
  }
  return result;
}

function updateMensaje(fila, texto) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return { success: false };
  hoja.getRange(fila, 2).setValue(texto);
  return { success: true };
}

// ============================================================
// API — PROMPT
// ============================================================
function getPromptActual() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PROMPTS");
  if (!hoja) return { prompt: "", version: 0, rollout: 100 };

  const data = hoja.getDataRange().getValues();
  // Última fila = prompt activo
  const last = data[data.length - 1];
  return {
    prompt: last[1]?.toString() || "",
    version: last[0]?.toString() || "1",
    rollout: parseInt(last[2]) || 100
  };
}

function getAllPrompts() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PROMPTS");
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    result.push({
      fila: i + 1,
      version: data[i][0]?.toString() || "",
      prompt: data[i][1]?.toString() || "",
      rollout: parseInt(data[i][2]) || 0,
      fecha: data[i][3]?.toString() || ""
    });
  }
  return result;
}

function eliminarPrompt(fila) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PROMPTS");
  if (!hoja) return { success: false };
  hoja.deleteRow(fila);
  return { success: true };
}

function guardarNuevoPrompt(texto, rolloutPct) {
  const ss = getDataSS();
  let hoja = ss.getSheetByName("PROMPTS");
  if (!hoja) {
    hoja = ss.insertSheet("PROMPTS");
    hoja.appendRow(["VERSION", "PROMPT", "ROLLOUT_PCT", "FECHA"]);
  }

  const data = hoja.getDataRange().getValues();
  const nuevaVersion = data.length; // siguiente número
  hoja.appendRow([nuevaVersion, texto, rolloutPct, new Date()]);
  return { success: true, version: nuevaVersion };
}

// ============================================================
// API — CHAT (leer conversación de un lead + enviar mensaje)
// ============================================================
function getConversacion(telefono) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES_CHAT");
  if (!hoja) return { telefono: telefono, mensajes: [] };

  const data = hoja.getDataRange().getValues();
  // Headers: TIMESTAMP | TELF | ORIGEN | TIPO | CONTENIDO
  const mensajes = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]?.toString().trim() === telefono) {
      mensajes.push({
        timestamp: data[i][0]?.toString() || "",
        origen: data[i][2]?.toString() || "",
        tipo: data[i][3]?.toString() || "",
        contenido: data[i][4]?.toString() || ""
      });
    }
  }
  return { telefono: telefono, mensajes: mensajes };
}

// Función de diagnóstico — ejecutar manualmente desde el editor
function testGetConversacion() {
  const result = getConversacion("000000000000");
  Logger.log("Resultado: " + JSON.stringify(result)?.substring(0, 500));
  
  const ss = getDataSS();
  const hoja = ss.getSheetByName("HISTORIAL_CHAT");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    Logger.log("Hoja encontrada: " + hoja.getName() + " | filas: " + data.length);
    if (data.length > 1) {
      Logger.log("Primera fila de datos — TELF: '" + data[1][1] + "' (tipo: " + typeof data[1][1] + ")");
    }
  } else {
    Logger.log("❌ No se encontró hoja HistorialChat ni HISTORIAL_CHAT");
  }
}

// ============================================================
// API — TRADUCCIONES DE PAYLOAD (para el chat del panel)
// Devuelve un mapa { "btn_CLOUD": "CLOUD ☁️", "cert_CLF": "Cloud Practitioner", ... }
// ============================================================
function getTraduccionesPayload() {
  const ss = getDataSS();
  const mapa = {};

  // 1. Mensajes (botones de texto)
  const hojaMsgs = ss.getSheetByName("MENSAJES");
  if (hojaMsgs) {
    const data = hojaMsgs.getDataRange().getValues();
    const msgs = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = data[i][1]?.toString() || "";
    }
    // Botones conocidos
    mapa["btn_menu_principal"] = msgs["MSG_BTN_MENU"] || "Menú principal";
    mapa["btn_confirmar_agendar"] = msgs["BTN_CM"] || "Ya agendé ✅";
    mapa["btn_reconfirmar"] = "Confirmar reunión ✅";
    mapa["btn_agendar_asesor"] = msgs["MSG_BTN_AGENDAR_ASESOR"] || "Agendar asesor";
    mapa["btn_2sem"] = msgs["MSG_BTN_2SEM"] || "2 semanas";
    mapa["btn_30dias"] = msgs["MSG_BTN_30DIAS"] || "30 días";
    mapa["btn_60dias"] = msgs["MSG_BTN_60DIAS"] || "60 días a más";

    // Botones de tecnología dinámicos
    const hojaAsesor = ss.getSheetByName("ASESORES");
    if (hojaAsesor) {
      const dataA = hojaAsesor.getDataRange().getValues();
      const headersA = dataA[0].map(h => h.toString().toUpperCase().trim());
      let colTech = headersA.indexOf("TECNOLOGIA_ID");
      if (colTech === -1) colTech = headersA.indexOf("TECNOLOGIA");
      const colTechBtn = headersA.indexOf("TECNOLOGIA_NOMBRE_BOTON");
      const colProv = headersA.indexOf("PROVIDER");
      const colBtn = headersA.indexOf("NOMBRE_BOTON");

      const techs = new Set();
      for (let i = 1; i < dataA.length; i++) {
        const tech = (dataA[i][colTech] || "").toString().trim();
        const techBtn = colTechBtn >= 0 ? (dataA[i][colTechBtn] || "").toString().trim() : "";
        const prov = (dataA[i][colProv] || "").toString().trim();
        const btnName = colBtn >= 0 ? (dataA[i][colBtn] || "").toString().trim() : "";

        if (tech) {
          const idLimpio = tech.toUpperCase().replace(/[^\w]/g, "").trim();
          if (!techs.has(idLimpio)) {
            techs.add(idLimpio);
            const claveTitulo = "MSG_BTN_" + idLimpio;
            mapa["btn_" + idLimpio] = techBtn || msgs[claveTitulo] || tech;
          }
        }
        if (prov) {
          mapa["btn_" + prov.toUpperCase()] = btnName || prov;
        }
      }
    }
  }

  // 2. Certificaciones
  const hojaCursos = ss.getSheetByName("CURSOS");
  if (hojaCursos) {
    const data = hojaCursos.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const colId = headers.indexOf("CERT_ID");
    const colNombre = headers.indexOf("NOMBRE_CERT");
    for (let i = 1; i < data.length; i++) {
      const certId = (data[i][colId] || "").toString().trim();
      const nombre = (data[i][colNombre] || "").toString().trim();
      if (certId && nombre) {
        mapa["cert_" + certId] = nombre;
      }
    }
  }

  return mapa;
}

function enviarMensajeManual(telefono, texto) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const token = props["ACCESS_TOKEN"];
  const phoneId = props["PHONE_NUMBER_ID"];

  if (!token || !phoneId) return { success: false, error: "Faltan credenciales WA" };

  const payload = {
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: { body: texto }
  };

  const res = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code === 200) {
    // Guardar en MENSAJES_CHAT para que aparezca en el chat del panel
    const ss = getDataSS();
    const hojaMsgs = ss.getSheetByName("MENSAJES_CHAT");
    if (hojaMsgs) {
      hojaMsgs.appendRow([new Date(), telefono, "asesor", "text", texto.substring(0, 1000)]);
    }
    return { success: true };
  }
  return { success: false, error: "WA error " + code };
}

// ============================================================
// ENVÍO MANUAL DE PASOS DEL FLUJO (con botones/listas reales)
// Permite que un asesor dispare desde el chat el mismo mensaje interactivo
// que enviaría el bot. Replica la lógica del bot (mismo Sheet, mismo token WA).
// ============================================================

/** POST a la Graph API + guardado en MENSAJES_CHAT. Devuelve {success,error?}. */
function _waPostFront(payload, tipoChat, contenidoChat) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const token = props["ACCESS_TOKEN"];
  const phoneId = props["PHONE_NUMBER_ID"];
  if (!token || !phoneId) return { success: false, error: "Faltan credenciales WA" };

  const res = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method: "post", contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200) {
    const ss = getDataSS();
    const hoja = ss.getSheetByName("MENSAJES_CHAT");
    if (hoja) hoja.appendRow([new Date(), payload.to, "asesor", tipoChat || payload.type, (contenidoChat || "").toString().substring(0, 1000)]);
    return { success: true };
  }
  return { success: false, error: "WA error " + code + ": " + res.getContentText().substring(0, 120) };
}

/** btn de WhatsApp (id + título recortado a 20). */
function _btnFront(id, titulo) {
  return { type: "reply", reply: { id: id, title: (titulo || "").toString().substring(0, 20) } };
}

/**
 * Genera las opciones efectivas de un paso, igual que el bot, para el FRONT.
 * @param {string} estado  Estado del paso (INICIO, NO_E_NUBE, NO_E_CERT, ...)
 * @param {Object} paso    JSON del paso (para opciones guardadas y visibilidad)
 * @param {string} provider Provider elegido (necesario para filtrar certs en NO_E_CERT)
 * @returns {Array} [{ id, titulo, siguiente }]
 */
function _opcionesEfectivasFront(estado, paso, provider) {
  const ss = getDataSS();
  const norm = (s) => (s || "").toString().toUpperCase().replace(/[^\w]/g, "");
  const est = (estado || "").toUpperCase();
  const guardadasMap = {};
  (paso && paso.opciones ? paso.opciones : []).forEach(op => { guardadasMap[op.id] = op; });
  const out = [];

  // Mensajes (para títulos MSG_BTN_*)
  const msgs = {};
  const hMsgs = ss.getSheetByName("MENSAJES");
  if (hMsgs) { const d = hMsgs.getDataRange().getValues(); for (let i=1;i<d.length;i++){ if (d[i][0]) msgs[d[i][0].toString().trim()] = (d[i][1]||"").toString(); } }

  if (est === "INICIO" || est === "NO_E_NUBE") {
    const hA = ss.getSheetByName("ASESORES");
    if (!hA) return out;
    const d = hA.getDataRange().getValues();
    const h = d[0].map(x => x.toString().toUpperCase().trim());
    const cTechId = h.indexOf("TECNOLOGIA_ID") >= 0 ? h.indexOf("TECNOLOGIA_ID") : h.indexOf("TECNOLOGIA");
    const cTechBtn = h.indexOf("TECNOLOGIA_NOMBRE_BOTON");
    const cProv = h.indexOf("PROVIDER");
    const cProvBtn = h.indexOf("NOMBRE_BOTON");
    const vistos = {};
    for (let i=1;i<d.length;i++){
      if (est === "INICIO") {
        const techId = norm(d[i][cTechId]);
        if (!techId || vistos[techId]) continue; vistos[techId] = true;
        const id = "btn_" + techId;
        const g = guardadasMap[id]; if (g && g.visible === false) continue;
        let titulo = (cTechBtn>=0 ? (d[i][cTechBtn]||"").toString().trim() : "") ;
        if (!titulo){ const k="MSG_BTN_"+techId; titulo = msgs[k] || techId; }
        out.push({ id: id, titulo: titulo, siguiente: (g && g.siguiente) || "NO_E_NUBE" });
      } else {
        const provRaw = (d[i][cProv]||"").toString().trim();
        const provId = norm(provRaw);
        if (!provId || vistos[provId]) continue; vistos[provId] = true;
        const id = "btn_" + provId;
        const g = guardadasMap[id]; if (g && g.visible === false) continue;
        const titulo = (cProvBtn>=0 ? (d[i][cProvBtn]||"").toString().trim() : "") || provRaw;
        out.push({ id: id, titulo: titulo, siguiente: (g && g.siguiente) || "NO_E_CERT" });
      }
    }
  } else if (est === "NO_E_CERT") {
    const hC = ss.getSheetByName("CURSOS");
    if (!hC) return out;
    const d = hC.getDataRange().getValues();
    const h = d[0].map(x => x.toString().toUpperCase().trim());
    const cId = h.indexOf("CERT_ID"), cNom = h.indexOf("NOMBRE_CERT"), cProv = h.indexOf("PROVIDER");
    const provSel = norm(provider);
    for (let i=1;i<d.length;i++){
      const certId = (d[i][cId]||"").toString().trim(); if (!certId) continue;
      if (provSel && norm(d[i][cProv]) !== provSel) continue; // filtrar por provider elegido
      const id = "cert_" + certId;
      const g = guardadasMap[id]; if (g && g.visible === false) continue;
      out.push({ id: id, titulo: (d[i][cNom]||"").toString().trim(), siguiente: (g && g.siguiente) || "NO_E_URGENCIA" });
    }
  } else {
    // Pasos libres: usar opciones guardadas visibles
    (paso && paso.opciones ? paso.opciones : []).filter(op => op.visible !== false).forEach(op => {
      const titulo = (msgs[op.titulo] || op.titulo || "").toString();
      out.push({ id: op.id, titulo: titulo, siguiente: op.siguiente || "" });
    });
  }
  return out;
}

/** Lista de providers del catálogo (para pedir la elección en el chat). */
function getProvidersDisponibles() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  const ss = getDataSS();
  const hA = ss.getSheetByName("ASESORES");
  if (!hA) return [];
  const d = hA.getDataRange().getValues();
  const h = d[0].map(x => x.toString().toUpperCase().trim());
  const cProv = h.indexOf("PROVIDER");
  const cProvBtn = h.indexOf("NOMBRE_BOTON");
  const vistos = {}; const out = [];
  for (let i=1;i<d.length;i++){
    const provRaw = (d[i][cProv]||"").toString().trim(); if (!provRaw) continue;
    const id = provRaw.toUpperCase();
    if (vistos[id]) continue; vistos[id] = true;
    out.push({ id: id, label: (cProvBtn>=0 ? (d[i][cProvBtn]||"").toString().trim() : "") || provRaw });
  }
  return out;
}

/**
 * Envía manualmente (como asesor) el mensaje real de un paso del flujo, con sus
 * botones/lista, tal como lo haría el bot.
 * @param {string} telefono
 * @param {string} estado  estado/paso a enviar (ej. "NO_E_CERT")
 * @param {Object} seleccion  { provider?: "AWS" } — para pasos que dependen de una elección
 * @returns {Object} { success, error? }
 */
function enviarPasoManual(telefono, estado, seleccion) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!telefono || !estado) return { success: false, error: "Faltan datos" };

  const sel = seleccion || {};
  const ss = getDataSS();

  // Buscar el paso en el flujo activo
  const paso = getFlujoCompleto().find(p => p && (p.estado||"").toUpperCase() === estado.toUpperCase() && p.activo !== false);
  if (!paso) return { success: false, error: "El paso no existe o está inactivo" };

  // Datos del lead + provider (elegido o el del lead) para resolver placeholders/certs
  let provider = (sel.provider || "").toString().trim();
  let curso = "";
  const hL = ss.getSheetByName("LEADS");
  if (hL) {
    const d = hL.getDataRange().getValues();
    for (let i=1;i<d.length;i++){
      if ((d[i][BCOL_FRONT.TELF]||"").toString().trim() === telefono){
        if (!provider) provider = (d[i][BCOL_FRONT.PROVIDER]||"").toString().trim();
        curso = (d[i][BCOL_FRONT.CURSO]||"").toString().trim();
        break;
      }
    }
  }

  // Link del asesor por provider
  let link = "";
  if (provider) {
    const hA = ss.getSheetByName("ASESORES");
    if (hA) {
      const d = hA.getDataRange().getValues();
      const h = d[0].map(x => x.toString().toUpperCase().trim());
      const cProv = h.indexOf("PROVIDER"), cLink = h.indexOf("LINK_AGENDAMIENTO");
      for (let i=1;i<d.length;i++){
        if (cProv>=0 && (d[i][cProv]||"").toString().trim().toUpperCase() === provider.toUpperCase()){
          link = cLink>=0 ? (d[i][cLink]||"").toString().trim() : ""; break;
        }
      }
    }
  }

  // Resolver el texto del paso
  const msgs = {};
  const hMsgs = ss.getSheetByName("MENSAJES");
  if (hMsgs) { const d = hMsgs.getDataRange().getValues(); for (let i=1;i<d.length;i++){ if (d[i][0]) msgs[d[i][0].toString().trim()] = (d[i][1]||"").toString(); } }
  let texto = (paso.mensaje || "").toString();
  if (texto.startsWith("MSG_")) texto = msgs[texto] || texto;
  texto = texto.replace(/\{PROVIDER\}/gi, provider.toUpperCase())
               .replace(/\{\{?\s*provider\s*\}?\}/gi, provider)
               .replace(/\{\{?\s*link\s*\}?\}/gi, link)
               .replace(/\{\{?\s*curso\s*\}?\}/gi, curso)
               .replace(/\{\{?\s*tecnologia\s*\}?\}/gi, provider)
               .trim();
  if (!texto || texto.startsWith("MSG_")) return { success: false, error: "El mensaje del paso no tiene texto configurado" };

  const tipo = (paso.tipo_mensaje || "texto").toString().toLowerCase();

  // Texto plano
  if (tipo === "texto" || tipo === "text") {
    return _waPostFront({ messaging_product:"whatsapp", to:telefono, type:"text", text:{ body:texto } }, "text", texto);
  }

  // Botones / lista → opciones efectivas
  const opciones = _opcionesEfectivasFront(estado, paso, provider);
  if (!opciones.length) {
    // Sin opciones → enviar como texto para no fallar
    return _waPostFront({ messaging_product:"whatsapp", to:telefono, type:"text", text:{ body:texto } }, "text", texto);
  }

  if (tipo === "button") {
    const botones = opciones.slice(0, 3).map(o => _btnFront(o.id, o.titulo));
    const payload = { messaging_product:"whatsapp", to:telefono, type:"interactive",
      interactive:{ type:"button", body:{ text:texto }, action:{ buttons:botones } } };
    const resumen = texto + "\n[Botones: " + opciones.slice(0,3).map(o=>o.titulo).join(" | ") + "]";
    return _waPostFront(payload, "interactive", resumen);
  }

  if (tipo === "list") {
    const filas = opciones.slice(0, 10).map(o => ({ id:o.id, title:(o.titulo||"").substring(0,24), description:"" }));
    const payload = { messaging_product:"whatsapp", to:telefono, type:"interactive",
      interactive:{ type:"list", body:{ text:texto }, action:{ button:"Ver opciones", sections:[{ title:"Opciones", rows:filas }] } } };
    const resumen = texto + "\n[Lista: " + opciones.slice(0,10).map(o=>o.titulo).join(" | ") + "]";
    return _waPostFront(payload, "interactive", resumen);
  }

  // Fallback
  return _waPostFront({ messaging_product:"whatsapp", to:telefono, type:"text", text:{ body:texto } }, "text", texto);
}

// Enviar imagen por WhatsApp (recibe base64 de la imagen)
function enviarImagenManual(telefono, base64Data, mimeType) {
  // Redirect al nuevo enviarArchivoManual para retrocompatibilidad
  return enviarArchivoManual(telefono, base64Data, mimeType, "archivo");
}

function enviarArchivoManual(telefono, base64Data, mimeType, fileName) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const token = props["ACCESS_TOKEN"];
  const phoneId = props["PHONE_NUMBER_ID"];

  if (!token || !phoneId) return { success: false, error: "Faltan credenciales WA" };

  // Validar tamaño (max 2MB)
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > 2 * 1024 * 1024) {
    return { success: false, error: "El archivo excede 2MB. Máximo permitido: 2MB." };
  }

  // Determinar tipo y carpeta GCS
  var tipoWA = "image";
  var carpetaGCS = "imagenes/asesor/";
  var extension = "jpg";
  var etiquetaChat = "[Imagen]";

  if (mimeType.startsWith("video/")) {
    tipoWA = "video";
    carpetaGCS = "videos/asesor/";
    extension = "mp4";
    etiquetaChat = "[Video]";
  } else if (mimeType === "application/pdf" || mimeType.includes("document") || mimeType.includes("msword")) {
    tipoWA = "document";
    carpetaGCS = "documentos/asesor/";
    extension = mimeType === "application/pdf" ? "pdf" : "docx";
    etiquetaChat = "[Documento]";
  } else if (mimeType === "image/png") {
    extension = "png";
  }

  const blob = Utilities.newBlob(bytes, mimeType, (fileName || "archivo") + "." + extension);

  // 1. Guardar en Cloud Storage
  var gcsPathFinal = "";
  try {
    gcsPathFinal = carpetaGCS + telefono + "_" + Date.now() + "." + extension;
    subirACloudStoragePanel(blob, gcsPathFinal, mimeType);
  } catch(e) {
    Logger.log("⚠️ GCS upload error (no crítico): " + e.message);
    gcsPathFinal = "";
  }

  // 2. Subir media a Meta
  const mediaRes = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/media", {
    method: "post",
    headers: { Authorization: "Bearer " + token },
    payload: {
      messaging_product: "whatsapp",
      type: mimeType,
      file: blob
    },
    muteHttpExceptions: true
  });

  const mediaCode = mediaRes.getResponseCode();
  if (mediaCode !== 200) return { success: false, error: "Error subiendo archivo a Meta: " + mediaCode + " - " + mediaRes.getContentText().substring(0, 100) };

  const mediaId = JSON.parse(mediaRes.getContentText()).id;

  // 3. Enviar al cliente
  const payload = {
    messaging_product: "whatsapp",
    to: telefono,
    type: tipoWA
  };
  payload[tipoWA] = { id: mediaId };
  if (tipoWA === "document") {
    payload[tipoWA].filename = fileName || "documento." + extension;
  }

  const res = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code === 200) {
    const ss = getDataSS();
    const hojaMsgs = ss.getSheetByName("MENSAJES_CHAT");
    if (hojaMsgs) {
      // Formato: gcs://ruta|nombre_original para mostrar en el panel
      var contenidoChat = gcsPathFinal ? "gcs://" + gcsPathFinal + "|" + (fileName || "archivo") : etiquetaChat;
      hojaMsgs.appendRow([new Date(), telefono, "asesor", tipoWA, contenidoChat]);
    }
    return { success: true };
  }
  return { success: false, error: "WA error " + code };
}

// ============================================================
// CLOUD STORAGE — funciones para el panel
// ============================================================

/**
 * Genera una URL firmada temporal (1 hora) para un objeto en GCS.
 * @param {string} path - Ruta del objeto (ej: "imagenes/asesor/000000000000_1724123456.jpg")
 * @returns {string} URL firmada o vacío si falla
 */
function getSignedUrl(path) {
  try {
    const keyJson = JSON.parse(PropertiesService.getScriptProperties().getProperty("GCS_SERVICE_ACCOUNT_KEY"));
    const bucket = PropertiesService.getScriptProperties().getProperty("GCS_BUCKET") || "your-media-bucket";
    const expiration = Math.floor(Date.now() / 1000) + 604800; // 7 días

    // Construir string to sign (V2 signing)
    const verb = "GET";
    const contentType = "";
    const resource = "/" + bucket + "/" + path;
    const stringToSign = verb + "\n" + "\n" + contentType + "\n" + expiration + "\n" + resource;

    // Firmar con la private key de la service account
    const signature = Utilities.base64Encode(
      Utilities.computeRsaSha256Signature(stringToSign, keyJson.private_key)
    );

    // Construir URL firmada
    const signedUrl = "https://storage.googleapis.com" + resource +
      "?GoogleAccessId=" + encodeURIComponent(keyJson.client_email) +
      "&Expires=" + expiration +
      "&Signature=" + encodeURIComponent(signature);

    return signedUrl;
  } catch (e) {
    Logger.log("❌ getSignedUrl error: " + e.message);
    return "";
  }
}

function subirACloudStoragePanel(blob, path, contentType) {
  const keyJson = JSON.parse(PropertiesService.getScriptProperties().getProperty("GCS_SERVICE_ACCOUNT_KEY"));
  const bucket = PropertiesService.getScriptProperties().getProperty("GCS_BUCKET") || "your-media-bucket";
  const now = Math.floor(Date.now() / 1000);

  // JWT token
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: keyJson.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signatureInput = header + "." + claim;
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(signatureInput, keyJson.private_key));
  const jwt = signatureInput + "." + signature;

  const tokenRes = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post", contentType: "application/x-www-form-urlencoded",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt },
    muteHttpExceptions: true
  });
  const token = JSON.parse(tokenRes.getContentText()).access_token;
  if (!token) throw new Error("No se pudo obtener token GCS");

  // Upload
  const url = "https://storage.googleapis.com/upload/storage/v1/b/" + bucket + "/o?uploadType=media&name=" + encodeURIComponent(path);
  const res = UrlFetchApp.fetch(url, {
    method: "post", contentType: contentType,
    headers: { Authorization: "Bearer " + token },
    payload: blob.getBytes(),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("GCS error: " + res.getResponseCode());
}

// ============================================================
// API — CATÁLOGO (Asesores, Cursos, Modalidades)
// CRUD completo para el panel de administración
// ============================================================

const CATALOGO_HOJAS = {
  asesores: "ASESORES",
  cursos: "CURSOS",
  modalidades: "MODALIDADES"
};

/**
 * Devuelve headers y rows de una sección del catálogo.
 * @param {string} seccion - "asesores", "cursos" o "modalidades"
 */
function getCatalogoData(seccion) {
  const nombreHoja = CATALOGO_HOJAS[seccion];
  if (!nombreHoja) return { headers: [], rows: [] };

  const ss = getDataSS();
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) return { headers: [], rows: [] };

  const data = hoja.getDataRange().getValues();
  if (data.length < 1) return { headers: [], rows: [] };

  const headers = data[0].map(h => h.toString().trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push(data[i].map(cell => cell?.toString() || ""));
  }

  return { headers: headers, rows: rows };
}

/**
 * Guarda todos los datos de una sección (reemplaza contenido completo).
 * Preserva los headers originales y escribe todas las filas.
 * @param {Object} payload - { seccion, headers, rows }
 */
function guardarCatalogoData(payload) {
  try {
    const seccion = payload.seccion;
    const nombreHoja = CATALOGO_HOJAS[seccion];
    if (!nombreHoja) return { success: false, error: "Sección inválida" };

    const ss = getDataSS();
    let hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) {
      // Crear la hoja si no existe
      hoja = ss.insertSheet(nombreHoja);
    }

    const headers = payload.headers;
    const rows = payload.rows;

    // Limpiar hoja completa
    hoja.clearContents();

    // Escribir headers
    if (headers.length) {
      hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    // Escribir datos
    if (rows.length && headers.length) {
      // Asegurar que cada fila tenga el mismo número de columnas que headers
      const normalizedRows = rows.map(row => {
        const r = [];
        for (let j = 0; j < headers.length; j++) {
          r.push(row[j] !== undefined ? row[j] : "");
        }
        return r;
      });
      hoja.getRange(2, 1, normalizedRows.length, headers.length).setValues(normalizedRows);
    }

    // Limpiar caché del bot para que los cambios se reflejen inmediatamente
    try {
      CacheService.getScriptCache().removeAll(["asesores", "cursos", "modalidades", "flujo_bot"]);
    } catch(e) { /* ignorar */ }

    // Limpiar opciones huérfanas del flujo (si se eliminó algo del catálogo)
    try {
      limpiarOpcionesHuerfanasFlujo(ss, seccion, rows, headers);
    } catch(e) { /* no fallar el guardado del catálogo por esto */ }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Elimina del flujo las opciones que ya no existen en el catálogo.
 */
function limpiarOpcionesHuerfanasFlujo(ss, seccion, rows, headers) {
  const hojaFlujo = ss.getSheetByName("FLUJO");
  if (!hojaFlujo) return;

  // Determinar qué IDs válidos quedan en el catálogo
  let idsValidos = new Set();

  if (seccion === "cursos") {
    const colId = headers.map(h => h.toUpperCase().trim()).indexOf("CERT_ID");
    if (colId >= 0) {
      rows.forEach(row => { if (row[colId]) idsValidos.add("cert_" + row[colId].toString().trim()); });
    }
  } else if (seccion === "asesores") {
    const hUp = headers.map(h => h.toUpperCase().trim());
    let colTech = hUp.indexOf("TECNOLOGIA_ID");
    if (colTech === -1) colTech = hUp.indexOf("TECNOLOGIA");
    const colProv = hUp.indexOf("PROVIDER");
    rows.forEach(row => {
      if (colTech >= 0 && row[colTech]) idsValidos.add("btn_" + row[colTech].toString().trim().toUpperCase().replace(/[^\w]/g, ""));
      if (colProv >= 0 && row[colProv]) idsValidos.add("btn_" + row[colProv].toString().trim().toUpperCase());
    });
  } else {
    return; // modalidades no afecta el flujo
  }

  // Leer flujo y limpiar opciones huérfanas
  const data = hojaFlujo.getDataRange().getValues();
  let cambio = false;
  for (let i = 1; i < data.length; i++) {
    try {
      const paso = JSON.parse(data[i][0]);
      if (!paso.opciones || !paso.opciones.length) continue;

      const opcionesLimpias = paso.opciones.filter(op => {
        // Opciones libres (no vinculadas al catálogo) se conservan siempre
        if (op._esLibre) return true;
        // Si el ID no empieza con btn_ o cert_, conservar
        if (!op.id.startsWith("btn_") && !op.id.startsWith("cert_")) return true;
        // Si es del catálogo, verificar que siga existiendo
        if (seccion === "cursos" && op.id.startsWith("cert_")) {
          return idsValidos.has(op.id);
        }
        if (seccion === "asesores" && op.id.startsWith("btn_")) {
          return idsValidos.has(op.id);
        }
        return true; // conservar por defecto
      });

      if (opcionesLimpias.length !== paso.opciones.length) {
        paso.opciones = opcionesLimpias;
        hojaFlujo.getRange(i + 1, 1).setValue(JSON.stringify(paso));
        cambio = true;
      }
    } catch(e) { /* ignorar filas inválidas */ }
  }
}

// ============================================================
// API — FLUJO (Editor de flujo del bot)
// El flujo se almacena como JSON en una hoja "FLUJO" (una fila = un JSON completo)
// ============================================================

/**
 * Devuelve el flujo completo como array de objetos.
 * Cada objeto = un paso del flujo.
 */
function getFlujoCompleto() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("FLUJO");
  if (!hoja) {
    // Si no existe la hoja, migrar el flujo actual hardcodeado
    return migrarFlujoInicial();
  }

  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return [];

  // Columna A = JSON del paso completo
  const result = [];
  for (let i = 1; i < data.length; i++) {
    try {
      const json = data[i][0]?.toString();
      if (json) {
        const paso = JSON.parse(json);
        // Backfill del rol: si el paso no lo tiene, se infiere del nombre del estado.
        // Así el flujo actual funciona sin migración y el rol pasa a ser la fuente de verdad.
        if (!paso.rol) paso.rol = inferirRolPaso(paso.estado);
        result.push(paso);
      }
    } catch (e) {
      // Ignorar filas con JSON inválido
    }
  }
  return result;
}

// ============================================================
// ROLES SEMÁNTICOS DE LOS PASOS DEL FLUJO
// El rol define el PROPÓSITO de un paso, independiente de su nombre.
// El motor del bot actúa según el rol, no según el nombre del estado,
// para que el flujo sea 100% editable/renombrable desde el panel.
// (Esta lista y inferirRolPaso deben mantenerse IGUALES en bot/Roles.gs)
// ============================================================
var ROLES_PASO = [
  { id: "saludo",             label: "Saludo / Inicio (punto de reinicio + elegir tecnología)" },
  { id: "pide_provider",      label: "Pide elegir proveedor (AWS, Azure, GCP...)" },
  { id: "pide_certificacion", label: "Pide elegir certificación (según proveedor)" },
  { id: "pide_urgencia",      label: "Pregunta urgencia / tiempo" },
  { id: "agenda",             label: "Agendamiento (envía el formulario de reserva)" },
  { id: "agendado",           label: "Ya agendó (confirmación de reserva)" },
  { id: "cierre",             label: "Cierre / estado final positivo" },
  { id: "remarketing",        label: "Remarketing (no respondió)" },
  { id: "normal",             label: "Paso normal (sin comportamiento especial)" }
];

/**
 * Infiere el rol de un paso a partir del nombre de estado legacy.
 * Solo se usa para pasos que aún no tienen rol explícito (retrocompatibilidad).
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
 * Devuelve flujo + mapa de mensajes + opciones dinámicas para el editor.
 */
function getFlujoConMensajes() {
  const flujo = getFlujoCompleto();
  const ss = getDataSS();

  // Cargar mensajes (clave → texto)
  const msgs = {};
  const hojaMsgs = ss.getSheetByName("MENSAJES");
  if (hojaMsgs) {
    const data = hojaMsgs.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = data[i][1]?.toString() || "";
    }
  }

  // Cargar opciones dinámicas de las hojas
  const opcionesDinamicas = {};

  // Tecnologías desde Asesores
  const hojaAsesores = ss.getSheetByName("ASESORES");
  if (hojaAsesores) {
    const data = hojaAsesores.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    let colTech = headers.indexOf("TECNOLOGIA_ID");
    if (colTech === -1) colTech = headers.indexOf("TECNOLOGIA");
    const colProv = headers.indexOf("PROVIDER");

    const colTechBtn = headers.indexOf("TECNOLOGIA_NOMBRE_BOTON");
    const colProvBtn = headers.indexOf("NOMBRE_BOTON");
    const techs = new Set();
    const provs = new Set();
    const techNombres = {}; // { ID_limpio: nombre_visible }
    const provNombres = {}; // { PROVIDER_upper: nombre_visible }
    for (let i = 1; i < data.length; i++) {
      const tech = (data[i][colTech] || "").toString().trim();
      const prov = (data[i][colProv] || "").toString().trim();
      const techBtn = colTechBtn >= 0 ? (data[i][colTechBtn] || "").toString().trim() : "";
      const provBtn = colProvBtn >= 0 ? (data[i][colProvBtn] || "").toString().trim() : "";
      if (tech) {
        const tid = tech.toUpperCase().replace(/[^\w]/g, "");
        techs.add(tid);
        if (!techNombres[tid]) techNombres[tid] = techBtn || tech;
      }
      if (prov) {
        const pid = prov.toUpperCase();
        provs.add(pid);
        if (!provNombres[pid]) provNombres[pid] = provBtn || prov;
      }
    }
    opcionesDinamicas["Asesores.TECNOLOGIA"] = [...techs];
    opcionesDinamicas["Asesores.PROVIDER"] = [...provs];
    opcionesDinamicas["Asesores.TECNOLOGIA_NOMBRES"] = techNombres;
    opcionesDinamicas["Asesores.PROVIDER_NOMBRES"] = provNombres;
  }

  // Certificaciones desde Cursos (con provider para filtrado)
  const hojaCursos = ss.getSheetByName("CURSOS");
  if (hojaCursos) {
    const data = hojaCursos.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const colNombre = headers.indexOf("NOMBRE_CERT");
    const colId = headers.indexOf("CERT_ID");
    const colProv = headers.indexOf("PROVIDER");

    const certs = [];
    for (let i = 1; i < data.length; i++) {
      const nombre = (data[i][colNombre] || "").toString().trim();
      const certId = (data[i][colId] || "").toString().trim();
      const prov = (data[i][colProv] || "").toString().trim().toUpperCase();
      if (nombre && certId) certs.push({ nombre: nombre, cert_id: certId, provider: prov });
    }
    opcionesDinamicas["Cursos"] = certs;
  }

  // Imágenes del flujo (para thumbnails en el editor)
  const hojaImg = ss.getSheetByName("IMAGENES_FLUJO");
  if (hojaImg) {
    const data = hojaImg.getDataRange().getValues();
    const imgs = [];
    for (let i = 1; i < data.length; i++) {
      const clave = (data[i][2] || "").toString().trim();
      const driveId = (data[i][3] || "").toString().trim();
      if (clave && driveId) imgs.push({ clave: clave, driveId: driveId });
    }
    opcionesDinamicas["_imagenes"] = imgs;
  }

  return { flujo: flujo, mensajes: msgs, opcionesDinamicas: opcionesDinamicas, disparadores: getDisparadores(), roles: ROLES_PASO };
}
/**
 * Guarda el flujo completo (reemplaza todo).
 * @param {Array} flujo - Array de objetos (cada uno es un paso)
 */
function guardarFlujoCompleto(flujo) {
  try {
    const ss = getDataSS();
    let hoja = ss.getSheetByName("FLUJO");
    if (!hoja) {
      hoja = ss.insertSheet("FLUJO");
    }

    // Limpiar
    hoja.clearContents();
    hoja.getRange(1, 1).setValue("PASO_JSON");
    hoja.getRange(1, 2).setValue("ESTADO");
    hoja.getRange(1, 3).setValue("ACTUALIZADO");

    // Escribir cada paso como JSON
    if (flujo && flujo.length) {
      const rows = flujo.map(function(paso) {
        return [JSON.stringify(paso), paso.estado || "", new Date()];
      });
      hoja.getRange(2, 1, rows.length, 3).setValues(rows);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Migra el flujo hardcodeado actual a la estructura data-driven.
 * Se ejecuta solo la primera vez (cuando no existe la hoja FLUJO).
 */
function migrarFlujoInicial() {
  const flujoInicial = [
    {
      estado: "INICIO",
      tipo_mensaje: "button",
      mensaje: "MSG_SALUDO_TECNOLOGIA",
      media_clave: "MSG_IMG_SALUDO",
      opciones: [
        { id: "btn_CLOUD", titulo: "MSG_BTN_CLOUD", siguiente: "NO_E_NUBE" },
        { id: "btn_IA", titulo: "MSG_BTN_IA", siguiente: "NO_E_CERT" },
        { id: "btn_EMPRESAS", titulo: "MSG_BTN_EMPRESAS", siguiente: "NO_E_CERT" }
      ],
      seguimientos: [],
      activo: true
    },
    {
      estado: "NO_E_TECNOLOGIA",
      tipo_mensaje: "button",
      mensaje: "MSG_SALUDO_TECNOLOGIA",
      media_clave: "MSG_IMG_SALUDO",
      opciones: [
        { id: "btn_CLOUD", titulo: "MSG_BTN_CLOUD", siguiente: "NO_E_NUBE" },
        { id: "btn_IA", titulo: "MSG_BTN_IA", siguiente: "NO_E_CERT" },
        { id: "btn_EMPRESAS", titulo: "MSG_BTN_EMPRESAS", siguiente: "NO_E_CERT" }
      ],
      seguimientos: [],
      activo: true
    },
    {
      estado: "NO_E_NUBE",
      tipo_mensaje: "button",
      mensaje: "MSG_NO_E_PROV",
      media_clave: "MSG_IMG_NO_E_PROV",
      opciones: [
        { id: "btn_AWS", titulo: "AWS", siguiente: "NO_E_CERT" },
        { id: "btn_AZURE", titulo: "Azure", siguiente: "NO_E_CERT" },
        { id: "btn_GCP", titulo: "GCP", siguiente: "NO_E_CERT" }
      ],
      seguimientos: [
        { tiempo: "18h", mensaje_clave: "MSG_SEG_NO_E_PROV_18H", media_clave: "MSG_IMG_SEG_NO_E_PROV_18H", estado_destino: "" }
      ],
      activo: true
    },
    {
      estado: "NO_E_CERT",
      tipo_mensaje: "list",
      mensaje: "MSG_CERTS_DISPONIBLES",
      media_clave: "MSG_IMG_CERTS_{PROVIDER}",
      opciones: [],
      seguimientos: [
        { tiempo: "18h", mensaje_clave: "MSG_SEG_NO_E_CERT_18H_{PROVIDER}", media_clave: "MSG_IMG_SEG_NO_E_CERT_18H_{PROVIDER}", estado_destino: "" }
      ],
      activo: true,
      nota: "Las opciones se generan dinámicamente desde la hoja Cursos"
    },
    {
      estado: "NO_E_URGENCIA",
      tipo_mensaje: "button",
      mensaje: "MSG_TIEMPO",
      media_clave: "MSG_IMG_CERT_{CERT_ID}",
      opciones: [
        { id: "btn_2sem", titulo: "MSG_BTN_2SEM", siguiente: "NO_CONFIRMO_MEET" },
        { id: "btn_30dias", titulo: "MSG_BTN_30DIAS", siguiente: "NO_CONFIRMO_MEET" },
        { id: "btn_60dias", titulo: "MSG_BTN_60DIAS", siguiente: "MAS_DE_60_DIAS" }
      ],
      seguimientos: [
        { tiempo: "18h", mensaje_clave: "MSG_SEG_18H_URGENCIA", media_clave: "", estado_destino: "" }
      ],
      activo: true
    },
    {
      estado: "NO_CONFIRMO_MEET",
      tipo_mensaje: "button",
      mensaje: "MSG_AGENDAR_ASESOR",
      media_clave: "",
      opciones: [
        { id: "btn_confirmar_agendar", titulo: "BTN_CM", siguiente: "CONFIRMO_MEET" },
        { id: "btn_menu_principal", titulo: "MSG_BTN_MENU", siguiente: "INICIO" }
      ],
      seguimientos: [
        { tiempo: "30min", mensaje_clave: "MSG_SEG_NCM_30M", media_clave: "MSG_VID_SEG_NCM_30M", estado_destino: "" },
        { tiempo: "2h", mensaje_clave: "MSG_SEG_NCM_2H", media_clave: "MSG_VID_SEG_NCM_2H", estado_destino: "" },
        { tiempo: "10h", mensaje_clave: "MSG_SEG_NCM_10H", media_clave: "MSG_IMG_SEG_NCM_10H", estado_destino: "" },
        { tiempo: "17h", mensaje_clave: "MSG_SEG_NCM_17H", media_clave: "MSG_IMG_SEG_NCM_17H", estado_destino: "" },
        { tiempo: "23h", mensaje_clave: "MSG_SEG_NCM_23H", media_clave: "", estado_destino: "REMARKETING_FALLIDO" }
      ],
      activo: true
    },
    {
      estado: "CONFIRMO_MEET",
      tipo_mensaje: "button",
      mensaje: "MSG_REINICIAR",
      media_clave: "",
      opciones: [
        { id: "btn_reconfirmar", titulo: "MSG_BTN_RECONFIRM", siguiente: "RECONFIRMO_MEET" },
        { id: "btn_menu_principal", titulo: "MSG_BTN_MENU", siguiente: "INICIO" }
      ],
      seguimientos: [
        { tiempo: "30min", mensaje_clave: "MSG_SEG_30MIN_RC", media_clave: "", estado_destino: "" },
        { tiempo: "15h", mensaje_clave: "MSG_SEG_15H_SIMULADOR", media_clave: "", estado_destino: "" },
        { tiempo: "22h", mensaje_clave: "MSG_REMARKETING", media_clave: "", estado_destino: "REMARKETING_FALLIDO" }
      ],
      activo: true
    },
    {
      estado: "RECONFIRMO_MEET",
      tipo_mensaje: "text",
      mensaje: "MSG_GRACIAS_AGENDA",
      media_clave: "",
      opciones: [],
      seguimientos: [
        { tiempo: "22h", mensaje_clave: "MSG_REMARKETING", media_clave: "", estado_destino: "REMARKETING_FALLIDO" }
      ],
      activo: true,
      nota: "Estado terminal positivo. Seguimiento solo si asesor marca remarketing."
    },
    {
      estado: "MAS_DE_60_DIAS",
      tipo_mensaje: "text",
      mensaje: "MSG_60DIAS",
      media_clave: "",
      opciones: [],
      seguimientos: [],
      activo: true,
      nota: "Estado terminal. Si escribe de nuevo, se ofrece menú principal."
    },
    {
      estado: "REMARKETING_FALLIDO",
      tipo_mensaje: "button",
      mensaje: "MSG_REINICIAR",
      media_clave: "",
      opciones: [
        { id: "btn_menu_principal", titulo: "MSG_BTN_MENU", siguiente: "INICIO" }
      ],
      seguimientos: [],
      activo: true,
      nota: "Estado terminal. Solo ofrece reiniciar."
    }
  ];

  // Guardar automáticamente
  guardarFlujoCompleto(flujoInicial);
  return flujoInicial;
}

// ============================================================
// API — MENSAJES DEL SISTEMA (editable desde el editor de flujo)
// ============================================================

/**
 * Guarda mensajes del sistema en la hoja Mensajes.
 * @param {Object} datos - { clave: texto, clave2: texto2, ... }
 */
function guardarMensajesSistema(datos) {
  try {
    const ss = getDataSS();
    const hoja = ss.getSheetByName("MENSAJES");
    if (!hoja) return { success: false, error: "Hoja Mensajes no existe" };

    const data = hoja.getDataRange().getValues();

    for (const [clave, texto] of Object.entries(datos)) {
      let encontrado = false;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]?.toString().trim() === clave) {
          hoja.getRange(i + 1, 2).setValue(texto);
          encontrado = true;
          break;
        }
      }
      // Si la clave no existe, agregarla
      if (!encontrado) {
        hoja.appendRow([clave, texto]);
      }
    }

    // Limpiar caché (incluye "disparadores_bot" por si se editó el texto de un disparador)
    try { CacheService.getScriptCache().removeAll(["mensajes", "disparadores_bot"]); } catch(e) {}

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// API — CAMBIAR MODO (Manual / Bot / Bot+IA)
// ============================================================
function cambiarModoLead(telefono, botActivo, iaActiva) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false };

  const data = hoja.getDataRange().getValues();
  const headers = data[0];
  const colTelf = headers.indexOf("TELF");
  const colIA = headers.indexOf("IA_ACTIVA");
  const colBot = headers.indexOf("BOT_ACTIVO");

  // Normalizar a 0/1 comparando explícitamente. El cliente puede enviar strings
  // ("0"/"1"); usar el valor como booleano directo daría "1" siempre (la string "0"
  // es truthy en JS), que era el bug por el que el modo volvía a Bot+IA.
  const iaVal  = (iaActiva === true  || iaActiva === 1  || iaActiva === "1") ? 1 : 0;
  const botVal = (botActivo === true || botActivo === 1 || botActivo === "1") ? 1 : 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][colTelf]?.toString().trim() === telefono) {
      if (colIA >= 0) hoja.getRange(i + 1, colIA + 1).setValue(iaVal);
      if (colBot >= 0) hoja.getRange(i + 1, colBot + 1).setValue(botVal);
      return { success: true };
    }
  }
  return { success: false };
}

// ============================================================
// API — CAMBIAR ESTADO DEL LEAD manualmente desde el chat.
// Permite que un asesor mueva a un cliente a otro paso del flujo.
// ============================================================

/**
 * Estados disponibles para el selector del chat: los pasos ACTIVOS del flujo de hoy.
 * @returns {Array} [{ id, label }]
 */
function getEstadosDisponibles() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  return getEstadosFlujoActivo();
}

// ============================================================
// CONFIG DE AGENDAMIENTO — todos los textos del Flow en un solo lugar.
// Se guardan como claves MSG_AGENDA_* en la hoja MENSAJES (fuente única que
// consume el bot). La página "Agendamiento" del panel los edita.
// ============================================================
const AGENDA_CAMPOS = [
  { clave: "MSG_AGENDA_FLOW_BODY",    label: "Mensaje del formulario (acompaña al botón)",
    hint: "Texto que ve el cliente junto al botón para abrir el formulario de reserva.",
    def: "📅 Reserva tu asesoría\n\nElige el horario que más te convenga y completa tus datos. ¡Es rápido!" },
  { clave: "MSG_AGENDA_FLOW_CTA",     label: "Texto del botón del formulario",
    hint: "El botón que abre el formulario (máx ~20 caracteres).",
    def: "Agendar ahora" },
  { clave: "MSG_AGENDA_CONFIRMADA",   label: "Mensaje de confirmación (al agendar)",
    hint: "Se envía cuando el cliente completa la reserva. Usa {{fecha}} para la fecha/hora elegida.",
    def: "¡Listo! ✅ Tu asesoría quedó agendada para:\n\n📅 {{fecha}}\n\nTe llegará un correo de confirmación. ¡Nos vemos! 🚀" },
  { clave: "MSG_AGENDA_SLOT_OCUPADO", label: "Mensaje de horario ocupado",
    hint: "Se envía si el horario elegido se ocupó justo antes de confirmar. Luego se reenvía el formulario.",
    def: "¡Uy! Ese horario acaba de ocuparse 😅. Aquí tienes los horarios disponibles ahora, por favor elige otro 👇" },
  { clave: "MSG_AGENDA_SIN_CUPOS",    label: "Mensaje sin horarios disponibles",
    hint: "Se envía si no hay ningún horario libre en los próximos días.",
    def: "Por ahora no tengo horarios disponibles 😔. Escríbeme más tarde y con gusto te agendo." },
  { clave: "MSG_AGENDA_ERROR_SLOT",   label: "Mensaje de error al leer el horario",
    hint: "Se envía si el horario elegido no se pudo interpretar. Luego se reenvía el formulario.",
    def: "No pude leer el horario elegido 🤔. Te reenvío las opciones." },
  { clave: "MSG_AGENDA_ERROR_CAL",    label: "Mensaje de error de calendario",
    hint: "Se envía si hubo un problema técnico con el calendario del asesor.",
    def: "Tuve un problema con el calendario 😔. Intenta de nuevo en un momento." }
];

/**
 * Devuelve la config de agendamiento: cada campo con su texto actual (o default).
 * @returns {Array} [{ clave, label, hint, texto }]
 */
function getConfigAgenda() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const ss = getDataSS();
  const msgs = {};
  const hoja = ss.getSheetByName("MENSAJES");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = (data[i][1] || "").toString();
    }
  }
  return AGENDA_CAMPOS.map(c => ({
    clave: c.clave,
    label: c.label,
    hint: c.hint,
    texto: (msgs[c.clave] !== undefined && msgs[c.clave] !== "") ? msgs[c.clave] : c.def
  }));
}

/**
 * Guarda los textos de agendamiento en la hoja MENSAJES.
 * @param {Object} datos - { MSG_AGENDA_FLOW_BODY: "...", ... }
 */
function guardarConfigAgenda(datos) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!datos || typeof datos !== "object") return { success: false, error: "Datos inválidos" };

  // Solo permitir las claves conocidas (seguridad)
  const permitidas = {};
  AGENDA_CAMPOS.forEach(c => permitidas[c.clave] = true);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return { success: false, error: "Hoja MENSAJES no existe" };
  const data = hoja.getDataRange().getValues();

  Object.keys(datos).forEach(clave => {
    if (!permitidas[clave]) return;
    const texto = (datos[clave] || "").toString();
    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim() === clave) {
        hoja.getRange(i + 1, 2).setValue(texto);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) hoja.appendRow([clave, texto]);
  });

  // Limpiar cache para que el bot tome los textos nuevos
  try { CacheService.getScriptCache().removeAll(["mensajes"]); } catch(e) {}
  return { success: true };
}

// ============================================================
// REINGRESO POR PAUTA — mensajes editables para cuando un lead que ya existe
// vuelve a entrar por un anuncio. Se guardan como claves MSG_REINGRESO_* en la
// hoja MENSAJES (misma fuente que consume el bot).
// ============================================================
const REINGRESO_CAMPOS = [
  { clave: "MSG_REINGRESO_NOSHOW",
    label: "No asistió a su cita (no-show) y vuelve por un anuncio",
    hint: "Se envía cuando un lead que tenía una cita marcada \"No asistió\" vuelve a escribir desde un anuncio. Después se le ofrece reagendar automáticamente.",
    def: "¡Hola de nuevo! 👋 Vimos que habías agendado una asesoría con nosotros pero no pudimos conectarnos. No pasa nada 😊, reagendemos en el horario que mejor te convenga 👇" },
  { clave: "MSG_REINGRESO_YA_CONVERSO",
    label: "Ya había conversado antes y vuelve por un anuncio",
    hint: "Se envía cuando un lead que ya había conversado con el bot vuelve a escribir desde un anuncio. Después se le ofrece agendar automáticamente.",
    def: "¡Qué bueno verte otra vez! 👋 Ya habíamos conversado antes. Para darte toda la información y resolver tus dudas, agenda una asesoría con nosotros 👇" }
];

/** Devuelve los textos de reingreso (texto actual o default). */
function getConfigReingreso() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  const ss = getDataSS();
  const msgs = {};
  const hoja = ss.getSheetByName("MENSAJES");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = (data[i][1] || "").toString();
    }
  }
  return REINGRESO_CAMPOS.map(c => ({
    clave: c.clave,
    label: c.label,
    hint: c.hint,
    texto: (msgs[c.clave] !== undefined && msgs[c.clave] !== "") ? msgs[c.clave] : c.def
  }));
}

/** Guarda los textos de reingreso en la hoja MENSAJES. */
function guardarConfigReingreso(datos) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!datos || typeof datos !== "object") return { success: false, error: "Datos inválidos" };

  const permitidas = {};
  REINGRESO_CAMPOS.forEach(c => permitidas[c.clave] = true);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return { success: false, error: "Hoja MENSAJES no existe" };
  const data = hoja.getDataRange().getValues();

  Object.keys(datos).forEach(clave => {
    if (!permitidas[clave]) return;
    const texto = (datos[clave] || "").toString();
    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim() === clave) {
        hoja.getRange(i + 1, 2).setValue(texto);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) hoja.appendRow([clave, texto]);
  });

  try { CacheService.getScriptCache().removeAll(["mensajes"]); } catch(e) {}
  return { success: true };
}

// ============================================================
// RECORDATORIOS DE ASESORÍA — textos editables (claves MSG_RECORD_* en MENSAJES).
// Variables disponibles: {fecha} (fecha/hora de la cita) y {link} (link de la Meet).
// ============================================================
const RECORDATORIO_CAMPOS = [
  { clave: "MSG_RECORD_CONFIRMAR",
    label: "Recordatorio 1 día antes (pide confirmar)",
    hint: "Se envía ~1 día antes de la cita, con botones Confirmar / No podré. Usa {fecha}.",
    def: "¡Hola! 👋 Te recordamos tu asesoría de Cloud Academy para mañana:\n\n📅 {fecha}\n\n¿Podrás asistir? Confírmanos para reservarte el cupo 👇" },
  { clave: "MSG_RECORD_DIA_CONFIRMADO",
    label: "El día de la cita — si confirmó (con link)",
    hint: "Se envía el día de la cita a quien confirmó. Usa {fecha} y {link} (link de la Meet).",
    def: "¡Hoy es tu asesoría! 🎉\n\n📅 {fecha}\n\n🔗 Únete por aquí a la hora acordada:\n{link}\n\n¡Te esperamos!" },
  { clave: "MSG_RECORD_DIA_SIN_CONFIRMAR",
    label: "El día de la cita — si NO confirmó (re-pide confirmar)",
    hint: "Se envía el día de la cita a quien no confirmó, con botones. Usa {fecha}.",
    def: "¡Hola! Hoy tienes tu asesoría de Cloud Academy:\n\n📅 {fecha}\n\nAún no nos confirmaste. ¿Podrás asistir? Confírmanos 👇" },
  { clave: "MSG_RECORD_BTN_CONFIRMAR",
    label: "Texto del botón \"Confirmar\"",
    hint: "Botón de confirmación (máx ~20 caracteres).",
    def: "✅ Sí, asistiré" },
  { clave: "MSG_RECORD_BTN_NO_PODRE",
    label: "Texto del botón \"No podré\"",
    hint: "Botón para rechazar (máx ~20 caracteres).",
    def: "❌ No podré" },
  { clave: "MSG_RECORD_CONFIRMADO_OK",
    label: "Respuesta cuando el cliente confirma",
    hint: "Se envía cuando el cliente pulsa Confirmar.",
    def: "¡Genial! 🙌 Tu asistencia quedó confirmada. El día de la sesión te enviaremos el enlace para unirte." },
  { clave: "MSG_RECORD_NO_PODRE",
    label: "Respuesta cuando el cliente dice que no podrá",
    hint: "Se envía cuando el cliente pulsa No podré. Después se le ofrece reagendar automáticamente.",
    def: "No hay problema 😊. Reagendemos para la fecha que mejor te convenga 👇" },
  { clave: "MSG_RECORD_LINK_RESPALDO",
    label: "Link de Meet de respaldo (opcional)",
    hint: "Solo para citas antiguas que no tengan su propia Meet. Déjalo vacío si no usas una sala fija.",
    def: "" }
];

/** Devuelve los textos de recordatorios (texto actual o default). */
function getConfigRecordatorios() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  const ss = getDataSS();
  const msgs = {};
  const hoja = ss.getSheetByName("MENSAJES");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = (data[i][1] || "").toString();
    }
  }
  return RECORDATORIO_CAMPOS.map(c => ({
    clave: c.clave, label: c.label, hint: c.hint,
    texto: (msgs[c.clave] !== undefined && msgs[c.clave] !== "") ? msgs[c.clave] : c.def
  }));
}

/** Guarda los textos de recordatorios en la hoja MENSAJES. */
function guardarConfigRecordatorios(datos) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!datos || typeof datos !== "object") return { success: false, error: "Datos inválidos" };

  const permitidas = {};
  RECORDATORIO_CAMPOS.forEach(c => permitidas[c.clave] = true);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return { success: false, error: "Hoja MENSAJES no existe" };
  const data = hoja.getDataRange().getValues();

  Object.keys(datos).forEach(clave => {
    if (!permitidas[clave]) return;
    const texto = (datos[clave] || "").toString();
    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim() === clave) {
        hoja.getRange(i + 1, 2).setValue(texto);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) hoja.appendRow([clave, texto]);
  });

  try { CacheService.getScriptCache().removeAll(["mensajes"]); } catch(e) {}
  return { success: true };
}

// ============================================================
// REPORTE DIARIO POR CORREO — config editable (claves MSG_REPORTE_* en MENSAJES).
// ============================================================
const REPORTE_CAMPOS = [
  { clave: "MSG_REPORTE_DESTINATARIOS",
    label: "Correos que reciben el reporte",
    hint: "Separados por coma. Ej: contact@example.com, advisor1@example.com",
    def: "contact@example.com, advisor1@example.com" },
  { clave: "MSG_REPORTE_ASUNTO",
    label: "Asunto del correo",
    hint: "Admite {fecha} (se reemplaza por la fecha de hoy).",
    def: "Reporte diario de asesorias - {fecha}" },
  { clave: "MSG_REPORTE_INTRO",
    label: "Texto introductorio del correo",
    hint: "Breve mensaje al inicio del reporte.",
    def: "Resumen operativo de asesorías de Cloud Academy. Revisa sobre todo a quién hay que contactar a mano." }
];

/** Devuelve la config del reporte (texto actual o default). */
function getConfigReporte() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  const ss = getDataSS();
  const msgs = {};
  const hoja = ss.getSheetByName("MENSAJES");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = (data[i][1] || "").toString();
    }
  }
  return REPORTE_CAMPOS.map(c => ({
    clave: c.clave, label: c.label, hint: c.hint,
    texto: (msgs[c.clave] !== undefined && msgs[c.clave] !== "") ? msgs[c.clave] : c.def
  }));
}

/** Guarda la config del reporte en la hoja MENSAJES. */
function guardarConfigReporte(datos) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!datos || typeof datos !== "object") return { success: false, error: "Datos inválidos" };

  const permitidas = {};
  REPORTE_CAMPOS.forEach(c => permitidas[c.clave] = true);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return { success: false, error: "Hoja MENSAJES no existe" };
  const data = hoja.getDataRange().getValues();

  Object.keys(datos).forEach(clave => {
    if (!permitidas[clave]) return;
    const texto = (datos[clave] || "").toString();
    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim() === clave) {
        hoja.getRange(i + 1, 2).setValue(texto);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) hoja.appendRow([clave, texto]);
  });

  try { CacheService.getScriptCache().removeAll(["mensajes"]); } catch(e) {}
  return { success: true };
}

// ============================================================
// CONFIG DE HORARIOS DEL AGENDAMIENTO — hoja CONFIG_AGENDA (clave-valor).
// El bot la lee en cargarConfigAgenda(). Formato de claves:
//   DURACION_MIN, BUFFER_MIN, DIAS, HORARIO_0..HORARIO_6 ("HH:MM-HH:MM" o "cerrado").
// ============================================================
const AGENDA_DIAS_SEMANA = [
  { idx: 1, label: "Lunes" },
  { idx: 2, label: "Martes" },
  { idx: 3, label: "Miércoles" },
  { idx: 4, label: "Jueves" },
  { idx: 5, label: "Viernes" },
  { idx: 6, label: "Sábado" },
  { idx: 0, label: "Domingo" }
];

// Defaults (coinciden con los del bot) por si la hoja aún no existe.
const AGENDA_HORARIO_DEF_FRONT = {
  0: "cerrado", 1: "11:00-19:30", 2: "11:00-19:30", 3: "11:00-19:30",
  4: "11:00-19:30", 5: "11:00-18:30", 6: "10:00-12:30"
};

/**
 * Devuelve la config de horarios del agendamiento para el panel.
 * @returns {Object} { duracion, buffer, dias, horarios: { 0..6: "HH:MM-HH:MM"|"cerrado" }, diasSemana }
 */
function getConfigAgendaHorario() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const cfg = { duracion: 20, buffer: 5, dias: 5, horarios: {}, diasSemana: AGENDA_DIAS_SEMANA };
  AGENDA_DIAS_SEMANA.forEach(d => cfg.horarios[d.idx] = AGENDA_HORARIO_DEF_FRONT[d.idx]);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("CONFIG_AGENDA");
  if (hoja) {
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const clave = (data[i][0] || "").toString().trim().toUpperCase();
      const val = (data[i][1] || "").toString().trim();
      if (clave === "DURACION_MIN") { const n = parseInt(val,10); if (n>0) cfg.duracion = n; }
      else if (clave === "BUFFER_MIN") { const n = parseInt(val,10); if (n>=0) cfg.buffer = n; }
      else if (clave === "DIAS") { const n = parseInt(val,10); if (n>0) cfg.dias = n; }
      else if (clave.indexOf("HORARIO_") === 0) {
        const dia = parseInt(clave.replace("HORARIO_",""),10);
        if (dia >= 0 && dia <= 6) cfg.horarios[dia] = val || "cerrado";
      }
    }
  }
  return cfg;
}

/**
 * Guarda la config de horarios en la hoja CONFIG_AGENDA (la crea si no existe).
 * @param {Object} datos - { duracion, buffer, dias, horarios: { 0..6: "HH:MM-HH:MM"|"cerrado" } }
 */
function guardarConfigAgendaHorario(datos) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!datos) return { success: false, error: "Datos inválidos" };

  // Validaciones básicas
  const dur = parseInt(datos.duracion, 10);
  const buf = parseInt(datos.buffer, 10);
  const dias = parseInt(datos.dias, 10);
  if (!(dur > 0)) return { success: false, error: "Duración inválida" };
  if (!(buf >= 0)) return { success: false, error: "Buffer inválido" };
  if (!(dias > 0 && dias <= 30)) return { success: false, error: "Días debe ser 1–30" };

  // Validar formato de cada horario
  const horarios = datos.horarios || {};
  for (let dia = 0; dia <= 6; dia++) {
    const v = (horarios[dia] || "").toString().trim();
    if (v && v.toLowerCase() !== "cerrado" && !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(v)) {
      return { success: false, error: "Horario inválido para el día " + dia + " (usa HH:MM-HH:MM o 'cerrado')" };
    }
  }

  const ss = getDataSS();
  let hoja = ss.getSheetByName("CONFIG_AGENDA");
  if (!hoja) {
    hoja = ss.insertSheet("CONFIG_AGENDA");
    hoja.appendRow(["CLAVE", "VALOR"]);
  }

  // Construir el set de claves a escribir
  const valores = {
    "DURACION_MIN": String(dur),
    "BUFFER_MIN": String(buf),
    "DIAS": String(dias)
  };
  for (let dia = 0; dia <= 6; dia++) {
    const v = (horarios[dia] || "").toString().trim();
    valores["HORARIO_" + dia] = (!v || v.toLowerCase() === "cerrado") ? "cerrado" : v;
  }

  // Upsert por clave
  const data = hoja.getDataRange().getValues();
  Object.keys(valores).forEach(clave => {
    let fila = -1;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim().toUpperCase() === clave) { fila = i + 1; break; }
    }
    if (fila > 0) hoja.getRange(fila, 2).setValue(valores[clave]);
    else hoja.appendRow([clave, valores[clave]]);
  });

  // Limpiar cache del bot (config_agenda) para que aplique de inmediato
  try { CacheService.getScriptCache().removeAll(["config_agenda"]); } catch(e) {}
  return { success: true };
}

// Color por defecto para "sin pauta".
const COLOR_SIN_PAUTA = "#B0B7C0";
// ID lógico que representa a los leads sin pauta en los filtros/segmentos.
// (No usar guiones bajos dobles al inicio/fin: Apps Script los reserva al
//  serializar arrays como propiedades y lanza error.)
const PAUTA_SIN_ID = "SIN_PAUTA";

/**
 * Mapa de nombres amigables de pauta (ID → NOMBRE) desde la hoja PAUTAS.
 * Si una pauta no tiene nombre asignado, no aparece aquí (se usará el ID).
 */
function _mapaNombresPauta() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PAUTAS");
  const mapa = {};
  if (!hoja) return mapa;
  const data = hoja.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const id = (data[i][0] || "").toString().trim();
    const nombre = (data[i][1] || "").toString().trim(); // col B = NOMBRE
    if (id && nombre) mapa[id] = nombre;
  }
  return mapa;
}

/**
 * Mapa de colores por pauta (ID → COLOR hex) desde la hoja PAUTAS (columna COLOR).
 * Si la columna no existe, la crea. Devuelve {} si no hay colores.
 */
function _mapaColoresPauta() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PAUTAS");
  const mapa = {};
  if (!hoja) return mapa;
  const data = hoja.getDataRange().getValues();
  if (!data.length) return mapa;
  const headers = data[0].map(h => h.toString().trim());
  const colColor = headers.indexOf("COLOR");
  if (colColor === -1) return mapa; // aún no hay colores asignados
  for (let i = 1; i < data.length; i++) {
    const id = (data[i][0] || "").toString().trim();
    const color = (data[i][colColor] || "").toString().trim();
    if (id && color) mapa[id] = color;
  }
  return mapa;
}

// Paleta por defecto, compartida por checkboxes y barras.
const PAUTA_PALETA = ["#2E86DE", "#27AE60", "#E67E22", "#8E44AD", "#16A085", "#E74C3C", "#F39C12", "#2C3E50"];

/**
 * FUENTE ÚNICA de color por pauta. Devuelve un mapa { pautaId -> colorHex } estable:
 * - Si la pauta tiene color en la hoja PAUTAS, se usa ese.
 * - Si no, se asigna de la paleta en orden de TOTAL de leads (desc), igual que los
 *   checkboxes, para que barras y leyenda SIEMPRE coincidan.
 * Incluye PAUTA_SIN_ID.
 */
function _mapaColorFinalPautas() {
  const ss = getDataSS();
  const coloresHoja = _mapaColoresPauta();

  // Contar leads por pauta para ordenar igual que getPautasConfig
  const totales = {};
  let haySinPauta = false;
  const hojaLeads = ss.getSheetByName("LEADS");
  if (hojaLeads) {
    const data = hojaLeads.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().trim());
    const colPauta = headers.indexOf("PAUTA_ID");
    for (let i = 1; i < data.length; i++) {
      const telf = (data[i][BCOL_FRONT.TELF] || "").toString().trim();
      if (!telf) continue;
      const id = (colPauta >= 0) ? (data[i][colPauta] || "").toString().trim() : "";
      if (id) totales[id] = (totales[id] || 0) + 1;
      else haySinPauta = true;
    }
  }

  const out = {};
  let idx = 0;
  // Mismo orden que los checkboxes: por total desc
  Object.keys(totales).sort((a, b) => totales[b] - totales[a]).forEach(id => {
    out[id] = coloresHoja[id] || PAUTA_PALETA[idx % PAUTA_PALETA.length];
    idx++;
  });
  // "sin pauta": color de la hoja o gris por defecto
  out[PAUTA_SIN_ID] = coloresHoja[PAUTA_SIN_ID] || COLOR_SIN_PAUTA;
  return out;
}

/**
 * Config completa de pautas para el panel: id, nombre, color y total de leads.
 * Incluye una entrada especial para "sin pauta".
 * @returns {Array} [{ id, label, color, total }]
 */
function getPautasConfig() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const ss = getDataSS();
  const nombres = _mapaNombresPauta();
  const colores = _mapaColoresPauta();

  // Contar leads por pauta en LEADS
  const totales = {};
  let sinPauta = 0;
  const hojaLeads = ss.getSheetByName("LEADS");
  if (hojaLeads) {
    const data = hojaLeads.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().trim());
    const colPauta = headers.indexOf("PAUTA_ID");
    for (let i = 1; i < data.length; i++) {
      const telf = (data[i][BCOL_FRONT.TELF] || "").toString().trim();
      if (!telf) continue;
      const id = (colPauta >= 0) ? (data[i][colPauta] || "").toString().trim() : "";
      if (id) totales[id] = (totales[id] || 0) + 1;
      else sinPauta++;
    }
  }

  // Color desde la FUENTE ÚNICA (mismo que usan las barras del embudo)
  const colorFinal = _mapaColorFinalPautas();
  const out = [];
  Object.keys(totales).sort((a, b) => totales[b] - totales[a]).forEach(id => {
    out.push({
      id: id,
      label: nombres[id] || id,
      color: colorFinal[id] || PAUTA_PALETA[0],
      total: totales[id]
    });
  });
  // Entrada para "sin pauta"
  if (sinPauta > 0) {
    out.push({ id: PAUTA_SIN_ID, label: "(sin pauta)", color: colorFinal[PAUTA_SIN_ID] || COLOR_SIN_PAUTA, total: sinPauta });
  }
  return out;
}

/**
 * Guarda el color de una pauta en la hoja PAUTAS (columna COLOR, la crea si falta).
 * Para "sin pauta" usa el ID lógico PAUTA_SIN_ID (se guarda como una fila especial).
 * @param {string} pautaId
 * @param {string} color hex (ej. "#2E86DE")
 */
function guardarColorPauta(pautaId, color) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  if (!pautaId) return { success: false, error: "Falta pautaId" };

  const ss = getDataSS();
  let hoja = ss.getSheetByName("PAUTAS");
  if (!hoja) {
    hoja = ss.insertSheet("PAUTAS");
    hoja.appendRow(["PAUTA_ID", "NOMBRE", "REF_HEADLINE", "REF_BODY", "PRIMERA_VEZ", "COLOR"]);
  }
  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  let colColor = headers.indexOf("COLOR");
  if (colColor === -1) {
    colColor = headers.length;
    hoja.getRange(1, colColor + 1).setValue("COLOR");
  }

  // Buscar la fila del ID
  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] || "").toString().trim() === pautaId) {
      hoja.getRange(i + 1, colColor + 1).setValue(color);
      return { success: true };
    }
  }
  // Si no existe (ej. "sin pauta"), crear una fila para guardar su color
  const fila = new Array(colColor + 1).fill("");
  fila[0] = (pautaId === PAUTA_SIN_ID) ? pautaId : "'" + pautaId;
  fila[1] = (pautaId === PAUTA_SIN_ID) ? "(sin pauta)" : "";
  fila[colColor] = color;
  hoja.appendRow(fila);
  return { success: true };
}

/**
 * Devuelve la pauta de un lead (para el badge del chat): { id, label, color } o null.
 */
function getPautaDeLead(telefono) {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");
  if (!telefono) return null;

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return null;
  const data = hoja.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const colPauta = headers.indexOf("PAUTA_ID");
  if (colPauta === -1) return null;

  for (let i = 1; i < data.length; i++) {
    if ((data[i][BCOL_FRONT.TELF] || "").toString().trim() === telefono) {
      const id = (data[i][colPauta] || "").toString().trim();
      if (!id) return null;
      const nombres = _mapaNombresPauta();
      const colores = _mapaColoresPauta();
      return { id: id, label: nombres[id] || id, color: colores[id] || "#2E86DE" };
    }
  }
  return null;
}

// ============================================================
// KANBAN DE LEADS (pipeline de ventas)
// Columnas = estados del flujo activo (data-driven) + etapas manuales de venta.
// La etapa del kanban se guarda en la columna KANBAN de LEADS (sin tocar ESTADO_BOT),
// para que el movimiento manual del asesor no sea pisado por el bot.
// ============================================================

// Etapas manuales de venta (no son estados del bot; las gestiona el asesor).
const KANBAN_MANUALES = [
  { id: "ASISTIO",     label: "✅ Asistió",     color: "#16a34a" },
  { id: "NO_ASISTIO",  label: "❌ No asistió",  color: "#dc2626" },
  { id: "CONVERTIDO",  label: "🎉 Convertido (alumno)", color: "#059669" }
];

// Busca el índice (0-based) de una columna por nombre en LEADS; si no existe, la crea al final.
function _leadsColIndexOrCreate(hoja, headers, nombre) {
  let idx = headers.indexOf(nombre);
  if (idx === -1) {
    idx = headers.length;
    hoja.getRange(1, idx + 1).setValue(nombre);
    headers.push(nombre);
  }
  return idx;
}

/**
 * Columnas del kanban: estados activos del flujo (en su orden) + etapas manuales.
 * Cada una: { id, label, color, manual }.
 */
function getKanbanConfig() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const estados = getEstadosFlujoActivo(); // [{id,label}] del flujo de hoy
  const paleta = ["#2E86DE", "#6b7280", "#2563eb", "#d97706", "#7c3aed", "#22c55e", "#0891b2", "#16a085", "#b45309"];
  const cols = estados.map((e, i) => ({
    id: e.id,
    label: e.label,
    color: paleta[i % paleta.length],
    manual: false
  }));
  // Agregar las etapas manuales de venta al final
  KANBAN_MANUALES.forEach(m => cols.push({ id: m.id, label: m.label, color: m.color, manual: true }));
  return cols;
}

/**
 * Devuelve los leads para el kanban desde la hoja LEADS del bot.
 * Crea las columnas KANBAN / ASESOR / CONTACTADO si no existen.
 * @returns {Array} [{ fila, telefono, provider, curso, estadoBot, kanban, asesor, contactado, pautaId, timestamp }]
 */
function getLeadsKanban() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return [];
  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => h.toString().trim());
  const colKanban     = _leadsColIndexOrCreate(hoja, headers, "KANBAN");
  const colAsesor     = _leadsColIndexOrCreate(hoja, headers, "ASESOR");
  const colContactado = _leadsColIndexOrCreate(hoja, headers, "CONTACTADO");
  const colPauta      = headers.indexOf("PAUTA_ID");
  const colMejor      = headers.indexOf("MEJOR_ESTADO_BOT");

  // Teléfonos que tienen al menos un agendamiento registrado (hoja AGENDAMIENTOS).
  const agendados = {};
  const hojaAg = ss.getSheetByName("AGENDAMIENTOS");
  if (hojaAg) {
    const da = hojaAg.getDataRange().getValues();
    const ha = da[0].map(x => x.toString().trim().toUpperCase());
    const cTel = ha.indexOf("TELF");
    if (cTel >= 0) for (let i = 1; i < da.length; i++) {
      const t = (da[i][cTel] || "").toString().trim();
      if (t) agendados[t] = true;
    }
  }

  // Mapa provider → tecnología (para clasificar/filtrar por tecnología).
  const techDeProvider = {};
  const mapaTP = getTecnologiasYProviders(); // { TECH: [PROV, PROV...] }
  Object.keys(mapaTP).forEach(tech => {
    (mapaTP[tech] || []).forEach(prov => { techDeProvider[prov.toUpperCase()] = tech; });
  });

  const out = [];
  for (let i = 1; i < data.length; i++) {
    const telf = (data[i][BCOL_FRONT.TELF] || "").toString().trim();
    if (!telf) continue;
    const provider = (data[i][BCOL_FRONT.PROVIDER] || "").toString().trim();
    const estadoBot = (data[i][BCOL_FRONT.ESTADO_BOT] || "").toString().trim().toUpperCase() || "INICIO";
    const mejor = (colMejor >= 0) ? (data[i][colMejor] || "").toString().trim().toUpperCase() : "";
    // "agendó" = tiene registro en AGENDAMIENTOS, o su estado (actual o el más
    // avanzado alcanzado) pasó por CONFIRMO_MEET/RECONFIRMO_MEET/agendado.
    const pasoPorAgenda = ["CONFIRMO_MEET","RECONFIRMO_MEET"].indexOf(estadoBot) !== -1 ||
                          ["CONFIRMO_MEET","RECONFIRMO_MEET"].indexOf(mejor) !== -1;
    const agendo = !!agendados[telf] || pasoPorAgenda;
    out.push({
      fila:       i + 1,
      telefono:   telf,
      provider:   provider,
      tecnologia: techDeProvider[provider.toUpperCase()] || "",
      curso:      (data[i][BCOL_FRONT.CURSO] || "").toString().trim(),
      estadoBot:  estadoBot,
      kanban:     (data[i][colKanban] || "").toString().trim(),
      asesor:     (data[i][colAsesor] || "").toString().trim(),
      contactado: (data[i][colContactado] || "").toString().trim() === "CONTACTADO",
      pautaId:    (colPauta >= 0) ? (data[i][colPauta] || "").toString().trim() : "",
      agendo:     agendo,
      timestamp:  data[i][BCOL_FRONT.CREATED_AT] ? new Date(data[i][BCOL_FRONT.CREATED_AT]).getTime() : 0
    });
  }
  return out;
}

/** Mueve un lead a una etapa del kanban (escribe la columna KANBAN).
 *  Si la etapa es ASISTIO / NO_ASISTIO / CONVERTIDO, también registra el
 *  resultado de la cita en la hoja AGENDAMIENTOS (para reportes/recordatorios). */
function moverLeadKanban(fila, nuevaColumna) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false, error: "No existe LEADS" };
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => h.toString().trim());
  const colKanban = _leadsColIndexOrCreate(hoja, headers, "KANBAN");
  hoja.getRange(fila, colKanban + 1).setValue(nuevaColumna);

  // Registrar resultado de la cita en AGENDAMIENTOS, si aplica.
  const resultadoCita = { "ASISTIO": "ASISTIO", "NO_ASISTIO": "NO_ASISTIO", "CONVERTIDO": "CONVERTIDO" }[nuevaColumna];
  if (resultadoCita) {
    const telf = (hoja.getRange(fila, BCOL_FRONT.TELF + 1).getValue() || "").toString().trim();
    if (telf) {
      // Datos del lead por si hay que crear la fila de agendamiento (citas por Calendly
      // que nunca pasaron por el Flow, por ejemplo).
      const datosLead = {
        provider: (hoja.getRange(fila, BCOL_FRONT.PROVIDER + 1).getValue() || "").toString().trim(),
        curso:    (hoja.getRange(fila, BCOL_FRONT.CURSO + 1).getValue() || "").toString().trim()
      };
      _marcarResultadoAgendamiento(ss, telf, resultadoCita, datosLead);
    }
  }
  return { success: true };
}

/** Marca el ESTADO del agendamiento más reciente de un teléfono.
 *  Si el teléfono no tiene ninguna fila en AGENDAMIENTOS (p.ej. una cita que se
 *  gestionó por Calendly y nunca pasó por el Flow), crea una nueva fila para que
 *  el lead aparezca igualmente en la vista "Agendamientos" del kanban. */
function _marcarResultadoAgendamiento(ss, telefono, estado, datosLead) {
  let hoja = ss.getSheetByName("AGENDAMIENTOS");
  // Encabezados de referencia (deben coincidir con guardarAgendamiento del bot).
  const HEADERS_DEF = ["TIMESTAMP","TELF","NOMBRE","CORREO","FECHA_HORA","ESTADO","EVENTO_ID","PROVIDER","CURSO"];
  if (!hoja) {
    hoja = ss.insertSheet("AGENDAMIENTOS");
    hoja.getRange(1, 1, 1, HEADERS_DEF.length).setValues([HEADERS_DEF]);
  }
  const data = hoja.getDataRange().getValues();
  let headers = (data[0] || []).map(h => h.toString().trim().toUpperCase());
  const col = (nombre) => headers.indexOf(nombre);
  let cTel = col("TELF");
  let cEstado = col("ESTADO");
  // Si faltan columnas base, completarlas al final.
  const asegurarCol = (nombre) => {
    let idx = headers.indexOf(nombre);
    if (idx === -1) { idx = headers.length; hoja.getRange(1, idx + 1).setValue(nombre); headers.push(nombre); }
    return idx;
  };
  if (cTel === -1) cTel = asegurarCol("TELF");
  if (cEstado === -1) cEstado = asegurarCol("ESTADO");

  // Buscar la fila más reciente (última) de ese teléfono.
  let filaObjetivo = -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][cTel] || "").toString().trim() === telefono) filaObjetivo = i + 1;
  }

  if (filaObjetivo > 0) {
    hoja.getRange(filaObjetivo, cEstado + 1).setValue(estado);
    return;
  }

  // No existe: crear una fila nueva con los datos disponibles del lead.
  const dl = datosLead || {};
  const cTime = asegurarCol("TIMESTAMP");
  const cProv = asegurarCol("PROVIDER");
  const cCurso = asegurarCol("CURSO");
  const nueva = new Array(headers.length).fill("");
  nueva[cTime]   = new Date();
  nueva[cTel]    = telefono;
  nueva[cEstado] = estado;
  nueva[cProv]   = dl.provider || "";
  nueva[cCurso]  = dl.curso || "";
  hoja.appendRow(nueva);
}

/** Asigna el asesor de un lead. */
function actualizarAsesorKanban(fila, asesor) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false, error: "No existe LEADS" };
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => h.toString().trim());
  const colAsesor = _leadsColIndexOrCreate(hoja, headers, "ASESOR");
  hoja.getRange(fila, colAsesor + 1).setValue(asesor || "");
  return { success: true };
}

/** Marca/desmarca CONTACTADO. */
function actualizarContactadoKanban(fila, contactado) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false, error: "No existe LEADS" };
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => h.toString().trim());
  const colC = _leadsColIndexOrCreate(hoja, headers, "CONTACTADO");
  hoja.getRange(fila, colC + 1).setValue(contactado ? "CONTACTADO" : "");
  return { success: true };
}

/**
 * Lista las pautas presentes en LEADS, usando el NOMBRE de la hoja PAUTAS si existe
 * (si no, el ID). Incluye cuántos leads trajo cada una. Para el selector del dashboard.
 * @returns {Array} [{ id, label, total }]
 */
function getPautasDisponibles() {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return [];
  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => h.toString().trim());
  const colPauta = headers.indexOf("PAUTA_ID");
  if (colPauta === -1) return []; // aún no hay columna de pauta

  const nombres = _mapaNombresPauta();
  const mapa = {};
  for (let i = 1; i < data.length; i++) {
    const id = (data[i][colPauta] || "").toString().trim();
    if (!id) continue;
    if (!mapa[id]) {
      mapa[id] = { id: id, label: nombres[id] || id, total: 0 };
    }
    mapa[id].total++;
  }
  // Ordenar por cantidad de leads (desc)
  return Object.keys(mapa).map(k => mapa[k]).sort((a, b) => b.total - a.total);
}

/**
 * Devuelve las plantillas de mensajes que un asesor puede insertar en el chat:
 *  - Mensajes de cada paso del flujo (texto resuelto desde la hoja MENSAJES).
 *  - Disparadores (precio, asesor, etc.).
 * Si se pasa el teléfono del lead, resuelve {{provider}} y {{link}} con sus datos.
 * @param {string} [telefono]
 * @returns {Object} { estados: [{estado,label,texto}], disparadores: [{clave,label,texto}] }
 */
function getMensajesRapidos(telefono) {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const ss = getDataSS();

  // Mapa de textos de la hoja MENSAJES (clave → texto)
  const msgs = {};
  const hojaMsgs = ss.getSheetByName("MENSAJES");
  if (hojaMsgs) {
    const data = hojaMsgs.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) msgs[data[i][0].toString().trim()] = (data[i][1] || "").toString();
    }
  }

  // Datos del lead (para resolver placeholders): provider + link del asesor
  let provider = "";
  let link = "";
  if (telefono) {
    const hojaLeads = ss.getSheetByName("LEADS");
    if (hojaLeads) {
      const dl = hojaLeads.getDataRange().getValues();
      for (let i = 1; i < dl.length; i++) {
        if ((dl[i][BCOL_FRONT.TELF] || "").toString().trim() === telefono) {
          provider = (dl[i][BCOL_FRONT.PROVIDER] || "").toString().trim();
          break;
        }
      }
    }
    if (provider) {
      const hojaAs = ss.getSheetByName("ASESORES");
      if (hojaAs) {
        const da = hojaAs.getDataRange().getValues();
        const h = da[0].map(x => x.toString().toUpperCase().trim());
        const cProv = h.indexOf("PROVIDER");
        const cLink = h.indexOf("LINK_AGENDAMIENTO");
        for (let i = 1; i < da.length; i++) {
          if (cProv >= 0 && (da[i][cProv] || "").toString().trim().toUpperCase() === provider.toUpperCase()) {
            link = cLink >= 0 ? (da[i][cLink] || "").toString().trim() : "";
            break;
          }
        }
      }
    }
  }

  // Resuelve una clave (o texto directo) a texto final con placeholders sustituidos.
  const resolver = (valor) => {
    let t = (valor || "").toString();
    if (t.startsWith("MSG_")) t = msgs[t] || t;                 // clave → texto de la hoja
    t = t.replace(/\{PROVIDER\}/gi, provider.toUpperCase());     // clave con {PROVIDER}
    t = t.replace(/\{\{?\s*provider\s*\}?\}/gi, provider);       // {{provider}} / {provider}
    t = t.replace(/\{\{?\s*link\s*\}?\}/gi, link);               // {{link}} / {link}
    return t.trim();
  };

  // 1. Mensajes de los pasos del flujo (solo activos, con texto real)
  const estados = [];
  getFlujoCompleto().forEach(p => {
    if (!p || p.activo === false) return;
    const texto = resolver(p.mensaje);
    // Omitir si quedó vacío o sin resolver (clave cruda)
    if (!texto || texto.startsWith("MSG_")) return;
    const label = (p.nombre_amigable || p.nombre || "").toString().trim() || (p.estado || "").replace(/_/g, " ");
    const est = (p.estado || "").toUpperCase();
    const tipo = (p.tipo_mensaje || "texto").toString().toLowerCase();
    // NO_E_CERT necesita que el asesor elija el provider antes de armar la lista de certs.
    const requiere = (est === "NO_E_CERT") ? "provider" : "";
    estados.push({ estado: p.estado, label: label, texto: texto, tipo: tipo, requiere: requiere });
  });

  // 2. Disparadores (con su texto)
  const disparadores = [];
  (getDisparadores() || []).forEach(d => {
    const texto = resolver(d.texto);
    if (!texto) return;
    disparadores.push({
      clave: d.clave,
      label: (d.label || d.clave.replace(/^DISP_/, "").replace(/_/g, " ")).toString(),
      texto: texto
    });
  });

  return { estados: estados, disparadores: disparadores };
}

/**
 * Cambia el ESTADO_BOT de un lead. Valida que el estado destino exista en el
 * flujo ACTIVO (no se puede mover a un paso eliminado). Registra la acción.
 * @param {string} telefono
 * @param {string} nuevoEstado - id de estado (ej. "NO_E_CERT")
 * @returns {Object} { success, estado?, label?, error? }
 */
function cambiarEstadoLead(telefono, nuevoEstado) {
  const u = obtenerUsuarioActual();
  if (!u.success) return { success: false, error: "No autorizado" };

  const estadoDestino = (nuevoEstado || "").toString().trim().toUpperCase();
  if (!estadoDestino) return { success: false, error: "Estado vacío" };

  // Validar contra el flujo activo
  const estadosValidos = getEstadosFlujoActivo();
  const match = estadosValidos.find(e => e.id === estadoDestino);
  if (!match) return { success: false, error: "El estado no existe en el flujo activo" };

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return { success: false, error: "Hoja LEADS no existe" };

  const data = hoja.getDataRange().getValues();
  const headers = data[0];
  const colTelf   = headers.indexOf("TELF");
  const colEstado = headers.indexOf("ESTADO_BOT");
  const colAccion = headers.indexOf("ACCION_BOT");
  const colUpd    = headers.indexOf("UPDATED_AT");
  if (colTelf < 0 || colEstado < 0) return { success: false, error: "Columnas no encontradas" };

  for (let i = 1; i < data.length; i++) {
    if (data[i][colTelf]?.toString().trim() === telefono) {
      hoja.getRange(i + 1, colEstado + 1).setValue(estadoDestino);
      // Marcar la acción como cambio manual (útil para no confundir con avance del bot)
      if (colAccion >= 0) {
        const accionPrev = (data[i][colAccion] || "").toString();
        hoja.getRange(i + 1, colAccion + 1).setValue(accionPrev + " > cambio_manual_estado");
      }
      if (colUpd >= 0) hoja.getRange(i + 1, colUpd + 1).setValue(new Date());
      return { success: true, estado: estadoDestino, label: match.label };
    }
  }
  return { success: false, error: "Lead no encontrado" };
}

// ============================================================
// API — DISPARADORES (mensajes automáticos con palabras clave)
// Se guardan en la hoja MENSAJES con prefijo DISP_ en la clave
// Columnas: A=CLAVE | B=TEXTO | C=ID BOTON | D=CANT CARACTERES | E=PALABRAS_CLAVE | F=MEDIA | G=ACTIVO | H=LABEL
// ============================================================

function getDisparadores() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const clave = (data[i][0] || "").toString().trim();
    if (clave.startsWith("DISP_")) {
      result.push({
        fila: i + 1,
        clave: clave,
        texto: (data[i][1] || "").toString(),
        palabras_clave: (data[i][4] || "").toString(),
        media: (data[i][5] || "").toString(),
        activo: (data[i][6] === "" || data[i][6] === null || data[i][6] === undefined)
          ? true
          : data[i][6].toString().trim() !== "0",
        label: (data[i][7] || "").toString()
      });
    }
  }
  return result;
}

function guardarDisparadores(disparadores) {
  try {
    const ss = getDataSS();
    const hoja = ss.getSheetByName("MENSAJES");
    if (!hoja) return { success: false, error: "Hoja MENSAJES no existe" };

    const data = hoja.getDataRange().getValues();

    // 1. Eliminar filas DISP_ existentes (de abajo hacia arriba para no alterar índices)
    const filasAEliminar = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim().startsWith("DISP_")) {
        filasAEliminar.push(i + 1);
      }
    }
    for (let i = filasAEliminar.length - 1; i >= 0; i--) {
      hoja.deleteRow(filasAEliminar[i]);
    }

    // 2. Agregar los disparadores nuevos al final
    for (const d of disparadores) {
      const clave = d.clave.startsWith("DISP_") ? d.clave : "DISP_" + d.clave.toUpperCase().replace(/[^\w]/g, "_");
      // Normalizar "activo" a booleano real antes de escribir "1"/"0".
      // Evita string-truthy: el string "0" es truthy en JS y guardaría "1" (activo) por error.
      const activoBool = (d.activo === true || d.activo === 1 || d.activo === "1" || d.activo === "true");
      hoja.appendRow([
        clave,
        d.texto || "",
        "",  // ID BOTON
        "",  // CANT CARACTERES
        d.palabras_clave || "",
        d.media || "",
        activoBool ? "1" : "0",
        d.label || ""
      ]);
    }

    // Limpiar cache del panel Y del bot (el bot cachea "disparadores_bot").
    // Sin esto, un disparador desactivado se sigue enviando hasta que expire el cache.
    try { CacheService.getScriptCache().removeAll(["mensajes", "disparadores_bot"]); } catch(e) {}

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// API — EMBUDO POR ESTADOS (Dashboard de distribución de leads)
// Devuelve la cantidad y el porcentaje de leads en cada estado del bot,
// filtrable por rango de fechas y provider.
// ============================================================

/**
 * Agrupa los leads por ESTADO_BOT con cantidad y porcentaje.
 * @param {Object} filtros - { desde, hasta, provider, orden }
 *        desde/hasta: "YYYY-MM-DD" (opcionales; default últimos 3 días)
 *        provider: "AWS"/"AZURE"/... o "TODOS"
 *        orden: "primera" usa CREATED_AT (col 0), cualquier otro usa UPDATED_AT (col 1)
 * @returns {Object} { total, desde, hasta, estados: [{ id, label, cantidad, porcentaje }] }
 */
/**
 * Convierte un código de estado (ej. "NO_E_CERT") en etiqueta legible sin guiones bajos.
 */
function _labelEstado(id) {
  return (id || "").toString().replace(/_/g, " ").trim();
}

/**
 * Devuelve los estados de los pasos ACTIVOS del flujo de HOY, en su orden de aparición
 * en la hoja FLUJO. Cada item: { id, label }. El label usa nombre_amigable si existe.
 */
function getEstadosFlujoActivo() {
  const flujo = getFlujoCompleto();
  const estados = [];
  const vistos = {};
  flujo.forEach(p => {
    if (!p || p.activo === false) return; // solo pasos activos hoy
    const id = (p.estado || "").toString().trim().toUpperCase();
    if (!id || vistos[id]) return;
    vistos[id] = true;
    const label = (p.nombre_amigable || p.nombre || "").toString().trim() || _labelEstado(id);
    estados.push({ id: id, label: label });
  });
  return estados;
}

/**
 * Agrupa los leads por ESTADO_BOT con cantidad y porcentaje.
 * @param {Object} filtros - { desde, hasta, provider, orden, incluirHistoricos }
 *        desde/hasta: "YYYY-MM-DD" (opcionales; default últimos 3 días)
 *        provider: "AWS"/"AZURE"/... o "TODOS"
 *        orden: "primera" usa CREATED_AT (col 0), cualquier otro usa UPDATED_AT (col 1)
 *        incluirHistoricos: si es true, muestra TODOS los estados que existan en LEADS
 *                           (incluidos pasos ya eliminados del flujo). Default: false →
 *                           solo los estados de los pasos activos del flujo de hoy.
 * @returns {Object} { total, desde, hasta, incluirHistoricos, estados: [{ id, label, cantidad, porcentaje, activo }] }
 */
function getEmbudoEstados(filtros) {
  const u = obtenerUsuarioActual();
  if (!u.success) throw new Error("No autorizado");

  const incluirHistoricos = !!(filtros && filtros.incluirHistoricos);

  // Estados base = pasos activos del flujo de hoy (data-driven, ya no hardcodeado).
  const estadosFlujo = getEstadosFlujoActivo();
  const labelDe = {};
  const ordenActivo = [];
  estadosFlujo.forEach(e => { labelDe[e.id] = e.label; ordenActivo.push(e.id); });
  const esActivo = {};
  ordenActivo.forEach(id => esActivo[id] = true);

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  const base = {
    total: 0, desde: "", hasta: "", incluirHistoricos: incluirHistoricos,
    estados: ordenActivo.map(id => ({ id: id, label: labelDe[id], cantidad: 0, porcentaje: 0, activo: true }))
  };
  if (!hoja) return base;

  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return base;

  // Rango de fechas — default últimos 3 días
  const ahora = new Date();
  const hace3dias = new Date(ahora.getTime() - 3 * 24 * 60 * 60 * 1000);
  const desde = filtros && filtros.desde ? new Date(filtros.desde + "T00:00:00") : hace3dias;
  const hasta = filtros && filtros.hasta ? new Date(filtros.hasta + "T23:59:59") : ahora;
  const colFecha = (filtros && filtros.orden === "primera") ? BCOL_FRONT.CREATED_AT : BCOL_FRONT.UPDATED_AT;
  const providerFiltro = (filtros && filtros.provider && filtros.provider !== "TODOS")
    ? filtros.provider.toUpperCase() : null;

  // Filtro por pauta. La columna PAUTA_ID se busca por nombre de header.
  const headersLeads = data[0].map(h => h.toString().trim());
  const colPauta = headersLeads.indexOf("PAUTA_ID");
  // pautasIncluidas: array de IDs a mostrar (incluye PAUTA_SIN_ID para "sin pauta").
  // Si no se pasa (null/vacío), se incluyen TODAS.
  const incluidas = (filtros && Array.isArray(filtros.pautasIncluidas) && filtros.pautasIncluidas.length)
    ? filtros.pautasIncluidas.map(x => x.toString().trim())
    : null;
  const setIncluidas = incluidas ? {} : null;
  if (incluidas) incluidas.forEach(id => setIncluidas[id] = true);
  // Retrocompat: filtro de una sola pauta (si algún caller viejo lo usa)
  const pautaFiltro = (filtros && filtros.pauta && filtros.pauta !== "TODAS")
    ? filtros.pauta.toString().trim() : null;

  // Nombre y color legibles de cada pauta (desde hoja PAUTAS).
  const nombresPauta = _mapaNombresPauta();
  const coloresPauta = _mapaColoresPauta();
  const tituloPauta = {};
  if (colPauta >= 0) {
    for (let i = 1; i < data.length; i++) {
      const pid = (data[i][colPauta] || "").toString().trim();
      if (pid && !tituloPauta[pid]) {
        tituloPauta[pid] = nombresPauta[pid] || pid;
      }
    }
  }

  // Conteo por estado + desglose por pauta.
  const conteo = {};                 // estado → total
  ordenActivo.forEach(id => conteo[id] = 0);
  const conteoHistorico = {};        // estados fuera del flujo activo
  const porEstadoPauta = {};         // estado → { pautaId → cantidad }
  const totalPorPauta = {};          // pautaId → total de leads de esa pauta (para % de conversión)
  let total = 0;

  for (let i = 1; i < data.length; i++) {
    const telf = (data[i][BCOL_FRONT.TELF] || "").toString().trim();
    if (!telf) continue;

    // Filtro por fecha
    const ts = new Date(data[i][colFecha]);
    if (isNaN(ts.getTime()) || ts < desde || ts > hasta) continue;

    // Filtro por provider
    if (providerFiltro) {
      const prov = (data[i][BCOL_FRONT.PROVIDER] || "").toString().trim().toUpperCase();
      if (prov !== providerFiltro) continue;
    }

    // Pauta del lead: su ID real, o PAUTA_SIN_ID si no tiene.
    const pautaRaw = (colPauta >= 0) ? (data[i][colPauta] || "").toString().trim() : "";
    const pautaLead = pautaRaw || PAUTA_SIN_ID;

    // Filtro: solo contar si la pauta está en la selección (si hay selección).
    if (setIncluidas && !setIncluidas[pautaLead]) continue;
    // Retrocompat: filtro de una sola pauta
    if (pautaFiltro && colPauta >= 0 && pautaRaw !== pautaFiltro) continue;

    const estado = (data[i][BCOL_FRONT.ESTADO_BOT] || "").toString().trim().toUpperCase() || "INICIO";

    if (esActivo[estado]) {
      conteo[estado]++;
    } else {
      conteoHistorico[estado] = (conteoHistorico[estado] || 0) + 1;
    }

    // Desglose por pauta (solo para estados que cuentan)
    if (esActivo[estado] || incluirHistoricos) {
      total++;
      if (!porEstadoPauta[estado]) porEstadoPauta[estado] = {};
      porEstadoPauta[estado][pautaLead] = (porEstadoPauta[estado][pautaLead] || 0) + 1;
      totalPorPauta[pautaLead] = (totalPorPauta[pautaLead] || 0) + 1;
    }
  }

  // Construye el array de segmentos (uno por pauta) para un estado dado.
  // pct_reparto: % de ese estado que es de la pauta (segmentos del estado suman 100%).
  // pct_conversion: % de los leads totales de la pauta que llegaron a ese estado.
  // Color desde la FUENTE ÚNICA (mismo mapa que los checkboxes/leyenda).
  const colorFinalMapa = _mapaColorFinalPautas();
  const colorDe = (pid) => colorFinalMapa[pid] || PAUTA_PALETA[0];
  const segmentosDe = (estadoId) => {
    const dist = porEstadoPauta[estadoId] || {};
    const cantEstado = Object.keys(dist).reduce((s, k) => s + dist[k], 0);
    return Object.keys(dist).sort((a, b) => dist[b] - dist[a]).map(pid => ({
      pauta_id: pid,
      label: (pid === PAUTA_SIN_ID) ? "(sin pauta)" : (tituloPauta[pid] || pid),
      color: colorDe(pid),
      cantidad: dist[pid],
      pct_reparto: cantEstado > 0 ? Math.round((dist[pid] / cantEstado) * 1000) / 10 : 0,
      pct_conversion: totalPorPauta[pid] > 0 ? Math.round((dist[pid] / totalPorPauta[pid]) * 1000) / 10 : 0
    }));
  };

  // Estados activos del flujo (en su orden), con sus segmentos por pauta
  const estados = ordenActivo.map(id => ({
    id: id,
    label: labelDe[id],
    cantidad: conteo[id],
    porcentaje: total > 0 ? Math.round((conteo[id] / total) * 1000) / 10 : 0,
    activo: true,
    segmentos: segmentosDe(id)
  }));

  // Solo en vista histórica: agregar los estados que ya no existen en el flujo.
  if (incluirHistoricos) {
    Object.keys(conteoHistorico).sort().forEach(id => {
      estados.push({
        id: id,
        label: _labelEstado(id) + " (histórico)",
        cantidad: conteoHistorico[id],
        porcentaje: total > 0 ? Math.round((conteoHistorico[id] / total) * 1000) / 10 : 0,
        activo: false,
        segmentos: segmentosDe(id)
      });
    });
  }

  return {
    total: total,
    desde: desde.toISOString().split("T")[0],
    hasta: hasta.toISOString().split("T")[0],
    incluirHistoricos: incluirHistoricos,
    totalPorPauta: totalPorPauta,
    estados: estados
  };
}

// Índices de columnas de la hoja LEADS (deben coincidir con BCOL del bot).
// Se define aquí de forma independiente para no depender del proyecto del bot.
const BCOL_FRONT = {
  CREATED_AT:        0,
  UPDATED_AT:        1,
  TELF:              2,
  PROVIDER:          3,
  CURSO:             4,
  ACCION_BOT:        5,
  ACCION_IA:         6,
  TURNOS_IA:         7,
  ESTADO_BOT:        8,
  MEJOR_ESTADO_BOT:  9,
  IA_ACTIVA:         10,
  BOT_ACTIVO:        11
};
