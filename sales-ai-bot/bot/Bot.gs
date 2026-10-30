// ============================================================
// YOUR_VERIFY_TOKEN
// Flujo 2 — Bot conversacional WhatsApp
// Script vinculado al sheet de datos (Asesores, Cursos, BotLeads)
// ============================================================

// ============================================================
// CONFIGURACIÓN
// ============================================================
const VERIFY_TOKEN  = "YOUR_VERIFY_TOKEN";

// El script es standalone → abre el sheet por ID desde Properties
function getDataSS() {
  const id = PropertiesService.getScriptProperties().getProperty("DATA_SHEET_ID");
  return SpreadsheetApp.openById(id);
}

// ============================================================
// CONFIGURACIÓN — lee credenciales de PropertiesService
// Propiedades requeridas en Script Properties:
//   ACCESS_TOKEN      → Token de Meta WhatsApp API
//   PHONE_NUMBER_ID   → Phone Number ID de Meta
//   NUMEROS_TEST      → Números de prueba separados por coma
//   TEST_NUMBER       → Número para probarDoPost()
//   DEEPSEEK_API_KEY  → API key de DeepSeek (usada en MotorIA.gs)
// ============================================================
function getProps() {
  return PropertiesService.getScriptProperties().getProperties();
}

// ============================================================
// ESTADOS DEL BOT
// ============================================================
const ESTADO = {
  INICIO:              "INICIO",              // saludo enviado, esperando tecnología (CLOUD/IA/EMPRESAS)
  NO_E_NUBE:           "NO_E_NUBE",           // eligió CLOUD, esperando provider (AWS/AZURE/GCP)
  NO_E_CERT:           "NO_E_CERT",           // eligió provider o tech directa, esperando cert
  NO_E_URGENCIA:       "NO_E_URGENCIA",       // respondió tiempo, esperando confirmación
  NO_CONFIRMO_MEET:    "NO_CONFIRMO_MEET",    // recibió link de agendamiento, aún no confirmó
  CONFIRMO_MEET:       "CONFIRMO_MEET",       // dio click a "Ya agendé" (btn_confirmar_agendar)
  RECONFIRMO_MEET:     "RECONFIRMO_MEET",     // dio click a btn_reconfirmar (seguimiento 30 min)
  MAS_DE_60_DIAS:      "MAS_DE_60_DIAS",      // eligió 60 días a más
  REMARKETING_FALLIDO: "REMARKETING_FALLIDO", // recibió remarketing 22h sin responder
  ALINEACION:          "ALINEACION"           // legacy
};

// ============================================================
// doGet — verificación del webhook con Meta
// ============================================================
function doGet(e) {
  const mode      = e.parameter["hub.mode"];
  const token     = e.parameter["hub.verify_token"];
  const challenge = e.parameter["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return ContentService.createTextOutput(challenge);
  }
  return ContentService.createTextOutput("Verificación fallida").setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
// doPost — recibe mensajes entrantes de WhatsApp
// ============================================================
function doPost(e) {
  // Responder OK a Meta inmediatamente para evitar reintentos
  const output = responderOK();
  
  try {
    const body = JSON.parse(e.postData.contents);

    // Soporta tanto el formato real de Meta como el payload de prueba del panel
    let value;
    if (body.field === "messages" && body.value) {
      value = body.value;
    } else {
      const entry   = body.entry?.[0];
      const changes = entry?.changes?.[0];
      value = changes?.value;
    }

    if (!value?.messages || !value.messages.length) {
      return output;
    }

    const mensaje = value.messages[0];
    if (!mensaje || !mensaje.type) {
      return output;
    }

    const telefono = (mensaje.from || "").toString().trim();
    const tipo     = mensaje.type;
    const msgId    = mensaje.id;
    console.log("📱 Mensaje de: " + telefono + " | tipo: " + tipo + " | id: " + msgId);

    // Sin teléfono no se puede procesar (ej. mensajes de sistema/eventos sin "from").
    // Evita crear leads fantasma (filas en LEADS con fecha pero sin TELF).
    if (!telefono) {
      logSheet("doPost", "ℹ️ INFO", "Mensaje sin 'from' (tipo " + tipo + "), ignorado.");
      return output;
    }

    // Ignorar mensajes duplicados con Lock + Cache
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(100)) {
      console.log("⚠️ Lock no obtenido, probable duplicado: " + msgId);
      return output;
    }
    
    try {
      const cache    = CacheService.getScriptCache();
      const cacheKey = "msg_" + msgId;
      if (cache.get(cacheKey)) {
        console.log("⚠️ Mensaje duplicado ignorado: " + msgId);
        return output;
      }
      cache.put(cacheKey, "1", 300); // 5 minutos para cubrir reintentos de Meta
    } finally {
      lock.releaseLock();
    }

    // ── Atribución de pauta: si el mensaje viene de un anuncio Click-to-WhatsApp,
    //    Meta incluye "referral" con el ID del anuncio. Lo guardamos en LEADS
    //    (solo la primera vez, para conservar la pauta de origen). ──
    if (mensaje.referral) {
      // Antes de registrar la pauta (que puede crear la fila del lead), detectamos si
      // el lead YA EXISTÍA. Si existía y vuelve a entrar por un anuncio, es un
      // "reingreso por pauta": dejamos una marca en cache que leerá el motor del flujo
      // para enviar el mensaje de reingreso adecuado (no-show / ya conversó).
      try {
        if (_leadYaExiste(telefono)) {
          CacheService.getScriptCache().put("reingreso_" + telefono, "1", 120);
        }
      } catch (e) { logSheet("doPost", "⚠️ WARNING", "reingreso check: " + e.message); }
      try { registrarPautaLead(telefono, mensaje.referral); }
      catch (e) { logSheet("doPost", "⚠️ WARNING", "referral: " + e.message); }
    }

    let payload = null;
    if (tipo === "interactive") {
      const interactive = mensaje.interactive;
      if (interactive.type === "button_reply") {
        payload = interactive.button_reply.id;
      } else if (interactive.type === "list_reply") {
        payload = interactive.list_reply.id;
      } else if (interactive.type === "nfm_reply") {
        // Respuesta de un WhatsApp Flow (ej. agendamiento). Se procesa aparte:
        // no entra al motor del flujo normal.
        try {
          const ssFlow = getDataSS();
          const msgsFlow = cargarMensajes(ssFlow);
          guardarMensajeChat(ssFlow, telefono, "lead", "flow", "[Completó el formulario de agenda]");
          procesarRespuestaFlow(telefono, interactive.nfm_reply, ssFlow, msgsFlow);
        } catch (e) {
          logSheet("doPost", "❌ ERROR", "nfm_reply: " + e.message + " | " + e.stack);
        }
        return output;
      }
    } else if (tipo === "text") {
      payload = mensaje.text.body;
    } else if (tipo === "image" || tipo === "video" || tipo === "document") {
      // Media del cliente → guardar en MENSAJES_CHAT siempre, intentar GCS
      const mediaObj = mensaje[tipo];
      const mediaId = mediaObj?.id;
      const ss = getDataSS();
      var contenido = "[" + tipo.charAt(0).toUpperCase() + tipo.slice(1) + "]";

      if (mediaId) {
        try {
          const gcsPath = guardarMediaCliente(telefono, mediaId, tipo, mediaObj);
          if (gcsPath) {
            contenido = "gcs://" + gcsPath + "|" + (mediaObj.filename || tipo);
          }
        } catch(e) {
          logSheet("doPost", "⚠️ WARNING", "Error guardando media del cliente en GCS: " + e.message);
        }
      }

      guardarMensajeChat(ss, telefono, "lead", tipo, contenido);
      return output;
    }

    if (!payload) return output;

    // ═══ ÚNICO PUNTO DE ESCRITURA — mensaje del lead → MENSAJES_CHAT ═══
    const ss = getDataSS();
    const tipoMsg = (tipo === "interactive") ? "boton" : "texto";
    // Traducir IDs de botones a texto legible (ej: "cert_CLF" → "Cloud Practitioner")
    const contenidoLead = (payload.startsWith("btn_") || payload.startsWith("cert_"))
      ? traducirPayloadCliente(payload)
      : payload;
    guardarMensajeChat(ss, telefono, "lead", tipoMsg, contenidoLead);

    procesarMensaje(telefono, payload, tipo);

  } catch (err) {
    logSheet("doPost", "❌ ERROR", "doPost error: " + err.message + " | stack: " + err.stack);
  }

  return output;
}

function responderOK() {
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// NÚMEROS DE TEST — lee de la hoja Config la clave NUMEROS_TEST
// Formato en el sheet: "5219991234567,5219997654321" (separados por coma)
// ============================================================
function esNumeroTest(telefono) {
  const cfg = getProps();
  const raw = cfg["NUMEROS_TEST"] || "";
  if (!raw) return false;
  const lista = raw.split(",").map(n => n.trim());
  return lista.includes(telefono);
}

// ============================================================
// PROCESADOR PRINCIPAL
// ============================================================
function procesarMensaje(telefono, payload, tipo) {
  // Flujo único data-driven (administrado desde el panel/hoja FLUJO) para TODOS los leads.
  // esNumeroTest() ya no decide el flujo; solo controla el límite de turnos de IA (ver procesarConIA).
  return procesarMensajeFlujoNuevo(telefono, payload, tipo);
}

// ============================================================
// MOTOR DATA-DRIVEN — lee el flujo desde la hoja FLUJO
// ============================================================
function cargarFlujoBot() {
  return getCached("flujo_bot", () => {
    const ss = getDataSS();
    const hoja = ss.getSheetByName("FLUJO");
    if (!hoja) return [];
    const data = hoja.getDataRange().getValues();
    const result = [];
    for (let i = 1; i < data.length; i++) {
      try {
        const json = data[i][0]?.toString();
        if (json) {
          const paso = JSON.parse(json);
          // Backfill del rol: pasos sin rol explícito → inferido del nombre (retrocompat).
          if (!paso.rol) paso.rol = inferirRolPaso(paso.estado);
          result.push(paso);
        }
      } catch (e) { /* ignorar filas inválidas */ }
    }
    return result;
  }, 10); // cache 10 segundos
}

function buscarPasoFlujo(flujo, estado) {
  return flujo.find(p => p.estado === estado && p.activo !== false) || null;
}

function procesarMensajeFlujoNuevo(telefono, payload, tipo) {
  const ss       = getDataSS();
  const lead     = obtenerOCrearLead(ss, telefono);
  let   estado   = lead.estado || ESTADO.INICIO;
  const asesores = cargarAsesoresBot(ss);
  const cursos   = cargarCursosBot(ss);
  const msgs     = cargarMensajes(ss);
  const flujo    = cargarFlujoBot();

  // ── Salvaguarda para el estado inicial legacy: cualquier lead que aún tenga
  // guardado el antiguo "NO_E_TECNOLOGIA" se trata como INICIO (paso del front). ──
  if (estado === "NO_E_TECNOLOGIA") {
    estado = ESTADO.INICIO;
    lead.estado = ESTADO.INICIO;
  }

  console.log("🆕 [FlujoNuevo] " + telefono + " | estado: " + estado + " | payload: " + payload);

  // ── Si bot está desactivado, no responder ──
  if (!lead.bot_activo) return;

  // ── Reingreso por pauta: el lead ya existía y vuelve a entrar por un anuncio.
  //    doPost dejó la marca "reingreso_<telefono>" en cache. Enviamos el mensaje
  //    adecuado y ofrecemos (re)agendar. Solo aplica a leads que ya tenían
  //    conversación previa (mejor_estado_bot distinto de INICIO). ──
  if (manejarReingresoPauta(ss, telefono, lead, msgs)) return;

  // ── Respuestas a los botones de recordatorio de asesoría (confirmar / no podré) ──
  if (manejarRespuestaRecordatorio(ss, telefono, payload, msgs)) return;

  // ── btn_menu_principal siempre reinicia ──
  if (payload === "btn_menu_principal") {
    reiniciarLead(ss, telefono);
    const pasoSaludo = buscarPasoFlujo(flujo, "INICIO");
    if (pasoSaludo) {
      ejecutarPasoFlujoDirecto(telefono, pasoSaludo, lead, ss, asesores, cursos, msgs);
    }
    return;
  }

  // ── Texto "menu"/"menú"/"inicio" → reiniciar ──
  const PALABRAS_MENU = ["menu", "menú", "inicio", "volver", "reiniciar"];
  if (tipo === "text" && PALABRAS_MENU.some(p => payload.toLowerCase().trim() === p)) {
    reiniciarLead(ss, telefono);
    const pasoSaludo = buscarPasoFlujo(flujo, "INICIO");
    if (pasoSaludo) ejecutarPasoFlujoDirecto(telefono, pasoSaludo, lead, ss, asesores, cursos, msgs);
    return;
  }

  // ── Detección de disparadores dinámicos (precio, asesor, etc.) ──
  if (tipo === "text") {
    const disparador = buscarDisparador(payload.toLowerCase(), msgs);
    if (disparador) {
      const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === (lead.provider || "").toUpperCase());
      const link = asesor?.LINK_AGENDAMIENTO || "";
      let texto = disparador.texto;
      texto = texto.replace(/\{\{link\}\}/g, link).replace(/\{link\}/g, link);
      texto = texto.replace(/\{\{provider\}\}/g, lead.provider || "").replace(/\{provider\}/g, lead.provider || "");
      texto = texto.replace(/\{\{curso\}\}/g, lead.curso || "").replace(/\{curso\}/g, lead.curso || "");
      // Enviar media si tiene
      if (disparador.media) {
        const mediaVal = getMediaId(disparador.media);
        if (mediaVal) {
          enviarMediaSinGuardar(telefono, mediaVal, "image");
          const driveId = getDriveIdByClave(disparador.media);
          guardarMensajeChat(ss, telefono, "bot", "image", driveId ? "drive://" + driveId + "|" + disparador.media : "[Imagen]");
          Utilities.sleep(300);
        }
      }
      enviarTexto(telefono, texto);
      actualizarLead(ss, telefono, { accion: "disparador_" + disparador.clave });
      return;
    }
  }

  // ── Si es un botón conocido → buscar en opciones del paso actual ──
  if (tipo === "interactive" || payload.startsWith("btn_") || payload.startsWith("cert_")) {

    // ══ Botones que SIEMPRE se interceptan primero (antes de procesar opciones del paso) ══
    if (payload === "btn_confirmar_agendar") {
      const verificacion = verificarAgendamiento(telefono);
      if (verificacion.encontrado) {
        const ev = verificacion.evento;
        let textoConfirm = msg(msgs, "MSG_AGENDA_ENCONTRADA") || "✅ ¡Confirmado! Tu asesoría está agendada para el {{fecha}} a las {{hora}}. ¡Nos vemos ahí!";
        textoConfirm = textoConfirm.replace(/\{\{fecha\}\}/g, ev.fecha).replace(/\{\{hora\}\}/g, ev.hora);
        textoConfirm = textoConfirm.replace(/\{fecha\}/g, ev.fecha).replace(/\{hora\}/g, ev.hora);
        enviarTexto(telefono, textoConfirm);
        actualizarLead(ss, telefono, { estado: "RECONFIRMO_MEET", accion: "confirmo_meet_verificado" });
      } else {
        const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === (lead.provider || "").toUpperCase());
        const link = asesor?.LINK_AGENDAMIENTO || "";
        let textoNoEncontrada = msg(msgs, "MSG_AGENDA_NO_ENCONTRADA") || "No encontramos tu agendamiento aún 🤔\n\nAsegúrate de agendar tu asesoría aquí:\n{{link}}\n\nCuando lo hagas, presiona el botón 👇";
        textoNoEncontrada = textoNoEncontrada.replace(/\{\{link\}\}/g, link);
        textoNoEncontrada = textoNoEncontrada.replace(/\{link\}/g, link);
        enviarMensajeWA({
          messaging_product: "whatsapp", to: telefono, type: "interactive",
          interactive: { type: "button", body: { text: textoNoEncontrada },
            action: { buttons: [btn("btn_confirmar_agendar", msg(msgs, "BTN_CM") || "Ya agendé"), btn("btn_menu_principal", msg(msgs, "MSG_BTN_MENU") || "Menú principal")] } }
        });
      }
      return;
    }

    let pasoActual = buscarPasoFlujo(flujo, estado);
    if (!pasoActual) {
      // Estado no encontrado en flujo → fallback al paso inicial (INICIO)
      ejecutarPasoFlujo(telefono, ESTADO.INICIO, lead, ss, asesores, cursos, msgs, flujo);
      actualizarLead(ss, telefono, { estado: ESTADO.INICIO, accion: "flujo_reset" });
      return;
    }

    // Buscar la opción que matchea el payload — en opciones guardadas Y en catálogo
    const opciones = pasoActual.opciones || [];
    let opcionElegida = opciones.find(op => op.id === payload);

    // Si no está en guardadas, buscar en opciones efectivas (catálogo)
    if (!opcionElegida) {
      const efectivas = obtenerOpcionesEfectivas(pasoActual, cursos, asesores, msgs, lead);
      const match = efectivas.find(op => op.id === payload);
      if (match) opcionElegida = { id: match.id, titulo: match.tituloResuelto, siguiente: match.siguiente };
    }

    if (opcionElegida && opcionElegida.siguiente) {
      // ══════════════════════════════════════════════════════════════════
      // MOTOR GENÉRICO: SIEMPRE se va al "siguiente" configurado en el editor.
      // Los efectos según el payload (guardar provider/curso) son solo datos
      // que se acumulan en el lead — NUNCA alteran el destino del flujo.
      // ══════════════════════════════════════════════════════════════════
      const destino = opcionElegida.siguiente;
      const campos = { estado: destino, accion: payload.replace("btn_", "").replace("cert_", "") };

      // Efecto de datos: si el payload es un provider del catálogo, guardarlo en el lead.
      // Se compara el ID normalizado del payload (btn_IA) contra el PROVIDER real (que puede
      // tener emojis/espacios, ej "IA 🧠"), y se guarda el PROVIDER REAL para que cursos/asesor coincidan.
      if (payload.indexOf("btn_") === 0) {
        const provCod = payload.replace("btn_", "").toUpperCase();
        const asesorProv = asesores.find(a => (a.PROVIDER || "").toUpperCase().replace(/[^\w]/g, "") === provCod.replace(/[^\w]/g, ""));
        if (asesorProv) campos.provider = (asesorProv.PROVIDER || "").toUpperCase();
      }
      // Efecto de datos: si el payload es una certificación, guardar el curso.
      if (payload.indexOf("cert_") === 0) {
        const certId = payload.replace("cert_", "");
        const curso = cursos.find(c => c.CERT_ID === certId);
        if (curso) {
          campos.curso = curso.NOMBRE_CERT;
          if (!campos.provider && curso.PROVIDER) campos.provider = curso.PROVIDER.toUpperCase();
        }
      }
      // Efecto de datos: al elegir tecnología con un único provider, heredarlo (para {{link}} y cursos).
      if (payload.indexOf("btn_") === 0 && !campos.provider) {
        const techCod = payload.replace("btn_", "").toUpperCase().replace(/[^\w]/g, "");
        const provsDeTech = [...new Set(asesores
          .filter(a => (a.TECNOLOGIA_ID || a.TECNOLOGIA || "").toUpperCase().replace(/[^\w]/g, "") === techCod)
          .map(a => (a.PROVIDER || "").toUpperCase()))];
        if (provsDeTech.length === 1) campos.provider = provsDeTech[0];
      }

      // Actualizar el lead y reflejar en memoria antes de ejecutar el paso destino.
      actualizarLead(ss, telefono, campos);
      lead.estado = destino;
      if (campos.provider) lead.provider = campos.provider;
      if (campos.curso) lead.curso = campos.curso;

      // Ejecutar el paso destino tal cual está configurado en el flujo.
      ejecutarPasoFlujo(telefono, destino, lead, ss, asesores, cursos, msgs, flujo);
      return;
    }

    // Botones globales (btn_reconfirmar, btn_agendar_asesor)
    // Nota: btn_confirmar_agendar ya se interceptó arriba (bloque "SIEMPRE se interceptan primero").
    if (payload === "btn_reconfirmar") {
      enviarTexto(telefono, msg(msgs, "MSG_GRACIAS_AGENDA"));
      actualizarLead(ss, telefono, { estado: "RECONFIRMO_MEET", accion: "reconfirmo_meet" });
      return;
    }
    if (payload === "btn_agendar_asesor") {
      // Nuevo flujo: enviar el WhatsApp Flow de agendamiento (calendario en vivo),
      // en lugar del link externo de Calendly. Si no hay cupos, enviarFlowAgendamiento
      // avisa y no cambia el estado.
      const enviado = enviarFlowAgendamiento(telefono, msgs);
      if (enviado) {
        actualizarLead(ss, telefono, { estado: "NO_CONFIRMO_MEET", accion: "flow_agenda_enviado" });
      }
      return;
    }

    // Opción no reconocida
    enviarErrorOpciones(telefono, msgs);
    return;
  }

  // ── Texto libre → IA (si está activa) ──
  if (!lead.ia_activa) return;

  // Saludos genéricos → ejecutar paso del flujo directamente (sin IA)
  const SALUDOS = ["hola", "buenas", "buenos dias", "buenos días", "buenas tardes", "buenas noches", "hi", "hello", "hey", "que tal", "qué tal", "ola"];
  // Normalizar: minúsculas, quitar signos de puntuación/emojis del inicio y entre palabras,
  // para que "Hola!", "¡Hola!", "Hola!!!", "Hola," etc. matcheen igual que "hola".
  const textoNorm = payload.toLowerCase().trim().replace(/^[¡!¿?.,;:\s]+/, '').replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const esGenerico = SALUDOS.some(s => textoNorm === s || textoNorm.startsWith(s + " "));

  if (estado === ESTADO.INICIO) {
    if (esGenerico) {
      // Saludo genérico → enviar el paso de saludo (INICIO)
      const pasoSaludo = buscarPasoFlujo(flujo, "INICIO");
      if (pasoSaludo) ejecutarPasoFlujoDirecto(telefono, pasoSaludo, lead, ss, asesores, cursos, msgs);
      actualizarLead(ss, telefono, { estado: ESTADO.INICIO, accion: "inicio" });
      return;
    }
    // Tiene intención (menciona cert, provider, etc.) → IA
    actualizarLead(ss, telefono, { estado: ESTADO.INICIO, accion: "inicio_con_intent" });
    const resultado = procesarConIA(telefono, payload, lead, ss, asesores, cursos, msgs);
    if (!resultado) {
      const pasoSaludo = buscarPasoFlujo(flujo, "INICIO");
      if (pasoSaludo) ejecutarPasoFlujoDirecto(telefono, pasoSaludo, lead, ss, asesores, cursos, msgs);
    }
    return;
  }

  // Otros estados — saludo genérico reinicia
  if (esGenerico) {
    reiniciarLead(ss, telefono);
    const pasoSaludo = buscarPasoFlujo(flujo, "INICIO");
    if (pasoSaludo) ejecutarPasoFlujoDirecto(telefono, pasoSaludo, lead, ss, asesores, cursos, msgs);
    return;
  }

  // Texto con intención en estado intermedio → IA
  const resultado = procesarConIA(telefono, payload, lead, ss, asesores, cursos, msgs);
  if (!resultado) return;
}

// ============================================================
// EJECUTAR PASO — envía el mensaje definido en un paso del flujo
// ============================================================
function ejecutarPasoFlujo(telefono, estadoDestino, lead, ss, asesores, cursos, msgs, flujo) {
  let paso = buscarPasoFlujo(flujo, estadoDestino);
  // Salvaguarda: si el paso destino no existe/está inactivo, no dejar al lead sin respuesta.
  // Se cae a INICIO para que el bot SIEMPRE conteste algo, aunque el flujo esté mal configurado.
  if (!paso) {
    logSheet("ejecutarPasoFlujo", "⚠️ WARNING", "Paso destino '" + estadoDestino + "' no existe en FLUJO. Fallback a INICIO.");
    paso = buscarPasoFlujo(flujo, ESTADO.INICIO);
    if (paso) actualizarLead(ss, telefono, { estado: ESTADO.INICIO });
  }
  if (!paso) {
    // Ni siquiera INICIO existe: enviar un mensaje seguro para no quedar mudo.
    enviarErrorOpciones(telefono, msgs);
    return;
  }
  ejecutarPasoFlujoDirecto(telefono, paso, lead, ss, asesores, cursos, msgs);
}

function ejecutarPasoFlujoDirecto(telefono, paso, lead, ss, asesores, cursos, msgs) {
  const asesor = asesores.find(a => (a.PROVIDER || "").toUpperCase() === (lead.provider || "").toUpperCase());
  const link = asesor?.LINK_AGENDAMIENTO || "";

  // Enviar media si existe
  if (paso.media_clave) {
    let clave = paso.media_clave;
    // Reemplazar variables dinámicas
    clave = clave.replace("{PROVIDER}", (lead.provider || "").toUpperCase());
    // Para CERT_ID: buscar el cert_id real a partir del nombre del curso
    if (clave.includes("{CERT_ID}")) {
      const cursoObj = cursos.find(c => c.NOMBRE_CERT === lead.curso);
      const certId = cursoObj ? cursoObj.CERT_ID : (lead.curso || "").toUpperCase();
      clave = clave.replace("{CERT_ID}", certId.toUpperCase());
    }
    const mediaVal = getMediaId(clave);
    if (mediaVal) {
      const tipoMedia = clave.includes("VID") ? "video" : "image";
      // Obtener ID Drive para guardar en MENSAJES_CHAT (para thumbnail en el panel)
      const driveId = getDriveIdByClave(clave);
      // Enviar pero NO dejar que enviarMensajeWA guarde en MENSAJES_CHAT (lo hacemos manualmente)
      enviarMediaSinGuardar(telefono, mediaVal, tipoMedia);
      // Guardar con referencia al Drive ID para thumbnail
      const ss = getDataSS();
      const contenidoMedia = driveId ? "drive://" + driveId + "|" + clave : "[" + tipoMedia + "]";
      guardarMensajeChat(ss, telefono, "bot", tipoMedia, contenidoMedia);
      Utilities.sleep(300);
    }
  }

  // Enviar mensaje según tipo — resolver placeholders {{...}}
  let textoMsg = paso.mensaje || "";
  // Si empieza con MSG_ es una clave de la hoja Mensajes
  if (textoMsg.startsWith("MSG_")) {
    textoMsg = msg(msgs, textoMsg, { link: link, provider: lead.provider || "" });
  }
  // Resolver placeholders {{...}} y {…} (retrocompatibilidad) en texto directo
  const varsReemplazo = {
    link: link,
    provider: lead.provider || "",
    curso: lead.curso || "",
    tecnologia: lead.provider || ""
  };
  textoMsg = textoMsg.replace(/\{\{(\w+)\}\}/g, function(match, key) {
    return varsReemplazo[key.toLowerCase()] || match;
  });
  textoMsg = textoMsg.replace(/\{(\w+)\}/g, function(match, key) {
    return varsReemplazo[key.toLowerCase()] || match;
  });

  // ── ROL "agenda": enviar el mensaje del paso y luego el Flow de agendamiento. ──
  // Data-driven: no depende del nombre del estado ni de un botón. Cualquier paso
  // marcado con rol "agenda" desde el panel dispara el formulario de reserva.
  if (rolDePaso(paso) === "agenda") {
    // Mensaje del paso (opcional): si está vacío, solo se envía el Flow.
    if (textoMsg && !textoMsg.startsWith("MSG_") && textoMsg.trim()) {
      enviarTexto(telefono, textoMsg);
      Utilities.sleep(300);
    }
    // Los textos del Flow son fuente única desde MENSAJES (página "Agendamiento").
    enviarFlowAgendamiento(telefono, msgs);
    return;
  }

  if (paso.tipo_mensaje === "text" || (!paso.opciones || !paso.opciones.length)) {
    enviarTexto(telefono, textoMsg);
    return;
  }

  if (paso.tipo_mensaje === "button") {
    const opcionesEfectivas = obtenerOpcionesEfectivas(paso, cursos, asesores, msgs, lead);
    const botones = opcionesEfectivas.slice(0, 3).map(op => btn(op.id, op.tituloResuelto));
    if (!botones.length) { enviarTexto(telefono, textoMsg); return; }
    enviarMensajeWA({
      messaging_product: "whatsapp", to: telefono, type: "interactive",
      interactive: { type: "button", body: { text: textoMsg }, action: { buttons: botones } }
    });
    return;
  }

  if (paso.tipo_mensaje === "list") {
    const opcionesEfectivas = obtenerOpcionesEfectivas(paso, cursos, asesores, msgs, lead);
    const filas = opcionesEfectivas.slice(0, 10).map(op => ({
      id: op.id, title: op.tituloResuelto.substring(0, 24), description: ""
    }));
    if (!filas.length) { enviarTexto(telefono, textoMsg); return; }
    enviarMensajeWA({
      messaging_product: "whatsapp", to: telefono, type: "interactive",
      interactive: { type: "list", body: { text: textoMsg },
        action: { button: "Ver opciones", sections: [{ title: "Opciones", rows: filas }] } }
    });
    return;
  }
}

/**
 * Obtiene las opciones efectivas de un paso: combina catálogo + opciones guardadas.
 * Resuelve títulos y filtra las ocultas.
 */
function obtenerOpcionesEfectivas(paso, cursos, asesores, msgs, lead) {
  const rol = rolDePaso(paso);
  const guardadas = paso.opciones || [];
  const guardadasMap = {};
  guardadas.forEach(op => { guardadasMap[op.id] = op; });

  // Destino por defecto de las opciones del catálogo = el paso cuyo rol es el
  // "siguiente lógico". Solo se usa si la opción guardada no define su propio
  // "siguiente". Así el flujo sigue navegando aunque se renombren los estados.
  const flujoCache = cargarFlujoBot();
  const destinoPorRol = (rolDestino) => estadoDeRol(flujoCache, rolDestino) || "";

  let resultado = [];

  // Opciones dinámicas del catálogo — se deciden por ROL del paso, no por nombre.
  // Así el flujo es editable/renombrable sin romper la generación de botones.
  if (rol === "saludo") {
    // ID estable del botón ← TECNOLOGIA_ID; texto visible ← TECNOLOGIA_NOMBRE_BOTON.
    // Fallback al comportamiento anterior (nombre limpiado) si esas columnas no existen.
    const vistos = {};
    asesores.forEach(a => {
      const techId = (a.TECNOLOGIA_ID || a.TECNOLOGIA || "").toUpperCase().replace(/[^\w]/g, "").trim();
      if (!techId || vistos[techId]) return;
      vistos[techId] = true;
      const id = "btn_" + techId;
      const guardada = guardadasMap[id];
      if (guardada && guardada.visible === false) return;
      // Texto: 1) TECNOLOGIA_NOMBRE_BOTON, 2) mensaje MSG_BTN_<id>, 3) el id.
      let titulo = a.TECNOLOGIA_NOMBRE_BOTON || "";
      if (!titulo) {
        const claveTitulo = "MSG_BTN_" + techId;
        titulo = msg(msgs, claveTitulo) !== claveTitulo ? msg(msgs, claveTitulo) : techId;
      }
      resultado.push({ id: id, tituloResuelto: titulo, siguiente: guardada?.siguiente || destinoPorRol("pide_provider") });
    });
  } else if (rol === "pide_provider") {
    const vistosProv = {};
    asesores.forEach(a => {
      const provRaw = (a.PROVIDER || "").trim();
      if (!provRaw) return;
      // ID normalizado (sin emojis/espacios), igual que genera el editor de flujo,
      // para que el toggle de visibilidad coincida correctamente.
      const provId = provRaw.toUpperCase().replace(/[^\w]/g, "");
      if (!provId || vistosProv[provId]) return;
      vistosProv[provId] = true;
      const id = "btn_" + provId;
      const guardada = guardadasMap[id];
      if (guardada && guardada.visible === false) return; // oculto desde el editor
      const titulo = a.NOMBRE_BOTON || provRaw;
      resultado.push({ id: id, tituloResuelto: titulo, siguiente: guardada?.siguiente || destinoPorRol("pide_certificacion") });
    });
  } else if (rol === "pide_certificacion") {
    // Generar dinámicamente las certs desde el catálogo, FILTRADAS por el provider
    // que eligió el lead. Sin este filtro se listaban las certs de todos los providers.
    // Se normaliza (mayúsculas, sin emojis/espacios) para tolerar valores como "AWS ☁️".
    const norm = (s) => (s || "").toString().toUpperCase().replace(/[^\w]/g, "");
    const provLead = norm(lead && lead.provider);
    cursos.forEach(c => {
      // Si el lead ya tiene provider, solo mostrar certs de ese provider.
      if (provLead && norm(c.PROVIDER) !== provLead) return;
      const id = "cert_" + c.CERT_ID;
      const guardada = guardadasMap[id];
      if (guardada && guardada.visible === false) return;
      resultado.push({ id: id, tituloResuelto: c.NOMBRE_CERT, siguiente: guardada?.siguiente || destinoPorRol("agenda") });
    });
  } else {
    // Pasos libres — usar opciones guardadas directamente
    guardadas.filter(op => op.visible !== false).forEach(op => {
      const titulo = msg(msgs, op.titulo) !== op.titulo ? msg(msgs, op.titulo) : op.titulo;
      resultado.push({ id: op.id, tituloResuelto: titulo, siguiente: op.siguiente || "" });
    });
    return resultado;
  }

  // Agregar opciones libres (_esLibre) que estén visibles
  guardadas.filter(op => op._esLibre && op.visible !== false).forEach(op => {
    const titulo = msg(msgs, op.titulo) !== op.titulo ? msg(msgs, op.titulo) : op.titulo;
    resultado.push({ id: op.id, tituloResuelto: titulo, siguiente: op.siguiente || "" });
  });

  return resultado;
}
// HELPER — enviar media (imagen o video)
// ============================================================
function enviarMedia(telefono, mediaVal, tipoMedia) {
  const esMediaId = /^\d+$/.test(mediaVal.trim());
  const payload = { messaging_product: "whatsapp", to: telefono, type: tipoMedia };
  payload[tipoMedia] = esMediaId ? { id: mediaVal.trim() } : { link: mediaVal.trim() };
  return enviarMensajeWA(payload);
}

// Enviar media sin que enviarMensajeWA guarde en MENSAJES_CHAT (se guarda manualmente después)
function enviarMediaSinGuardar(telefono, mediaVal, tipoMedia) {
  const cfg = getProps();
  const token = cfg["ACCESS_TOKEN"] || cfg["WA_TOKEN"];
  const phoneId = cfg["PHONE_NUMBER_ID"] || cfg["WA_PHONE_ID"];
  if (!token || !phoneId) return;

  const esMediaId = /^\d+$/.test(mediaVal.trim());
  const payload = { messaging_product: "whatsapp", to: telefono, type: tipoMedia };
  payload[tipoMedia] = esMediaId ? { id: mediaVal.trim() } : { link: mediaVal.trim() };

  UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method: "post", contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// Obtener ID Drive de una clave de media (desde IMAGENES_FLUJO)
function getDriveIdByClave(clave) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("IMAGENES_FLUJO");
  if (!hoja) return "";
  const data = hoja.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2]?.toString().trim() === clave) {
      return data[i][3]?.toString().trim() || "";
    }
  }
  return "";
}

// ============================================================
// DISPARADORES — lee palabras clave de la hoja MENSAJES (filas DISP_)
// ============================================================
function cargarDisparadoresBot() {
  return getCached("disparadores_bot", () => {
    const ss = getDataSS();
    const hoja = ss.getSheetByName("MENSAJES");
    if (!hoja) return [];
    const data = hoja.getDataRange().getValues();
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const clave = (data[i][0] || "").toString().trim();
      if (clave.startsWith("DISP_")) {
        // OJO: la celda puede contener el NÚMERO 0 (no el string "0").
        // No usar (data[i][6] || "1") porque 0 es falsy → devolvería "1" y nunca se desactivaría.
        const gRaw = data[i][6];
        const activo = (gRaw === "" || gRaw === null || gRaw === undefined)
          ? "1"
          : gRaw.toString().trim();
        if (activo === "0") continue; // saltear desactivados
        const palabras = (data[i][4] || "").toString().split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
        if (palabras.length) {
          result.push({
            clave: clave,
            texto: (data[i][1] || "").toString(),
            palabras: palabras,
            media: (data[i][5] || "").toString().trim()
          });
        }
      }
    }
    return result;
  }, 10);
}

function buscarDisparador(textoLower, msgs) {
  const disparadores = cargarDisparadoresBot();
  for (const d of disparadores) {
    if (d.palabras.some(p => textoLower.includes(p))) {
      return d;
    }
  }
  return null;
}

// ============================================================
// HELPER — buscar Meta ID de media en IMAGENES_FLUJO (con fallback a Mensajes)
// ============================================================
function getMediaId(clave) {
  return getCached("media_" + clave, () => {
    const ss = getDataSS();
    // 1. Buscar en IMAGENES_FLUJO (columna C = clave, columna F = Meta ID)
    const hojaMedia = ss.getSheetByName("IMAGENES_FLUJO");
    if (hojaMedia) {
      const data = hojaMedia.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][2]?.toString().trim() === clave) {
          let metaId = data[i][5];
          // Manejar notación científica (viene como string "1.66592E+15" o como número)
          if (typeof metaId === "number") {
            metaId = metaId.toFixed(0);
          } else {
            metaId = metaId?.toString().trim() || "";
            // Si es notación científica en string, convertir
            if (metaId.includes("E+") || metaId.includes("e+")) {
              metaId = BigInt(parseFloat(metaId)).toString();
            }
          }
          if (metaId) return metaId;
        }
      }
    }
    // 2. Fallback: buscar en hoja MENSAJES
    const hojaMsgs = ss.getSheetByName("MENSAJES");
    if (hojaMsgs) {
      const data = hojaMsgs.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]?.toString().trim() === clave) {
          let val = data[i][1];
          if (typeof val === "number") val = val.toFixed(0);
          else {
            val = val?.toString().trim() || "";
            if (val.includes("E+") || val.includes("e+")) val = BigInt(parseFloat(val)).toString();
          }
          return val;
        }
      }
    }
    return "";
  }, 10); // cache 10 segundos
}

// ============================================================
// MENSAJES SALIENTES
// ============================================================

function btn(id, titulo) {
  return { type: "reply", reply: { id: id, title: titulo.substring(0, 20) } };
}

function msg(msgs, clave, vars) {
  let texto = msgs[clave] || clave;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      texto = texto.replace(new RegExp("\\{" + k + "\\}", "g"), v);
    }
  }
  return texto;
}

function enviarSaludo(telefono, asesores, msgs) {
  // Tecnologías únicas por TECNOLOGIA_ID (con fallback al nombre). Botón: id estable + nombre visible.
  const vistos = {};
  const botones = [];
  asesores.forEach(a => {
    if (botones.length >= 3) return; // WhatsApp permite máx. 3 botones
    const techId = (a.TECNOLOGIA_ID || a.TECNOLOGIA || "").toUpperCase().replace(/[^\w]/g, "").trim();
    if (!techId || vistos[techId]) return;
    vistos[techId] = true;
    let titulo = a.TECNOLOGIA_NOMBRE_BOTON || "";
    if (!titulo) {
      const claveTitulo = "MSG_BTN_" + techId;
      titulo = msg(msgs, claveTitulo) !== claveTitulo ? msg(msgs, claveTitulo) : (a.TECNOLOGIA || techId);
    }
    botones.push({ type: "reply", reply: { id: "btn_" + techId, title: titulo.substring(0, 20) } });
  });

  // Enviar imagen de saludo si existe
  const imgSaludo = msg(msgs, "MSG_IMG_SALUDO");
  if (imgSaludo && imgSaludo !== "MSG_IMG_SALUDO") {
    const esMediaId = /^\d+$/.test(imgSaludo.trim());
    enviarMensajeWA({
      messaging_product: "whatsapp",
      to:   telefono,
      type: "image",
      image: esMediaId ? { id: imgSaludo.trim() } : { link: imgSaludo.trim() }
    });
    Utilities.sleep(300);
  }

  enviarMensajeWA({
    messaging_product: "whatsapp",
    to: telefono,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: msg(msgs, "MSG_SALUDO_TECNOLOGIA") || "¡Hola! 👋 ¿En qué área te gustaría certificarte?" },
      action: { buttons: botones }
    }
  });
}

function enviarListaCertificaciones(telefono, provider, certs, msgs) {
  const filas = certs.slice(0, 9).map(c => ({
    id:          "cert_" + c.CERT_ID,
    title:       c.NOMBRE_CERT.substring(0, 24),
    description: ""
  }));

  // Agregar opción "Volver a Inicio" al final
  filas.push({ id: "btn_menu_principal", title: "Volver a Inicio", description: "" });

  // Enviar imagen del provider si existe
  const claveImgProvider = "MSG_IMG_CERTS_" + provider.toUpperCase();
  const imgProvider = msg(msgs, claveImgProvider);
  if (imgProvider && imgProvider !== claveImgProvider) {
    const esMediaId = /^\d+$/.test(imgProvider.trim());
    enviarMensajeWA({
      messaging_product: "whatsapp",
      to:   telefono,
      type: "image",
      image: esMediaId ? { id: imgProvider.trim() } : { link: imgProvider.trim() }
    });
    Utilities.sleep(300);
  }

  const payloadLista = {
    messaging_product: "whatsapp",
    to: telefono,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: msg(msgs, "MSG_CERTS_DISPONIBLES", { provider }) },
      action: {
        button:   (msg(msgs, "MSG_BTN_VER_CERTS") || "Ver certificaciones").substring(0, 20),
        sections: [{ title: provider.substring(0, 24), rows: filas }]
      }
    }
  };
  enviarMensajeWA(payloadLista);
}



// Registro temporal del último mensaje del bot por número (deprecated — se mantiene por compatibilidad)
const _ultimoMsgBot = {};

// Origen con el que enviarMensajeWA registra los mensajes salientes en MENSAJES_CHAT.
// Por defecto "bot"; el MotorIA lo cambia a "ia" mientras responde y lo restaura al terminar.
var _origenSaliente = "bot";

function enviarTexto(telefono, texto) {
  enviarMensajeWA({
    messaging_product: "whatsapp",
    to:   telefono,
    type: "text",
    text: { body: texto }
  });
}

function enviarErrorOpciones(telefono, msgs) {
  enviarMensajeWA({
    messaging_product: "whatsapp",
    to: telefono,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: msg(msgs, "MSG_ERROR_OPCIONES") || "Por favor, elige una de las opciones 🙌🏻" },
      action: {
        buttons: [
          btn("btn_menu_principal", msg(msgs, "MSG_BTN_MENU") || "Menú principal")
        ]
      }
    }
  });
}

function enviarMensajeWA(payload) {
  const cfg     = getProps();
  const token   = cfg["ACCESS_TOKEN"] || cfg["WA_TOKEN"];
  const phoneId = cfg["PHONE_NUMBER_ID"] || cfg["WA_PHONE_ID"];

  if (!token || !phoneId) {
    Logger.log("❌ Faltan ACCESS_TOKEN o PHONE_NUMBER_ID en Config sheet");
    return null;
  }

  const res  = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method:      "post",
    contentType: "application/json",
    headers:     { Authorization: "Bearer " + token },
    payload:     JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    logSheet("enviarMensajeWA", "❌ ERROR", "WA error " + code + ": " + body.substring(0, 200));
  } else {
    // ═══ ÚNICO PUNTO DE ESCRITURA — mensaje saliente → MENSAJES_CHAT ═══
    // El origen es "bot" por defecto, o "ia" si el envío proviene del MotorIA
    // (ver _origenSaliente, que MotorIA activa durante procesarConIA).
    try {
      const telefono = payload.to;
      const contenido = extraerContenidoMensaje(payload);
      const tipo = payload.type || "text";
      const ss = getDataSS();
      guardarMensajeChat(ss, telefono, (typeof _origenSaliente !== "undefined" ? _origenSaliente : "bot"), tipo, contenido);
    } catch (e) {
      Logger.log("⚠️ Error guardando msg saliente: " + e.message);
    }
  }
  return code + " | " + body.substring(0, 200);
}

// ============================================================
// MENSAJES_CHAT — registra cada mensaje individual en hoja separada
// Hoja: MENSAJES_CHAT | Columnas: TIMESTAMP | TELF | ORIGEN | TIPO | CONTENIDO
// ============================================================
function guardarMensajeChat(ss, telefono, origen, tipo, contenido) {
  const hoja = ss.getSheetByName("MENSAJES_CHAT");
  if (!hoja) return;
  hoja.appendRow([new Date(), telefono, origen, tipo, (contenido || "").substring(0, 1000)]);
}

function extraerContenidoMensaje(payload) {
  const tipo = payload.type;
  if (tipo === "text") {
    return payload.text?.body || "";
  }
  if (tipo === "interactive") {
    const inter = payload.interactive;
    const bodyText = inter?.body?.text || "";
    // Extraer botones o lista
    if (inter?.type === "button") {
      const btns = inter.action?.buttons?.map(function(b) { return b.reply?.title || ""; }) || [];
      return bodyText + "\n[Botones: " + btns.join(" | ") + "]";
    }
    if (inter?.type === "list") {
      const rows = inter.action?.sections?.[0]?.rows?.map(function(r) { return r.title || ""; }) || [];
      return bodyText + "\n[Lista: " + rows.join(" | ") + "]";
    }
    if (inter?.type === "flow") {
      // Formulario (Flow). Mostrar el body + el botón del formulario (CTA).
      const cta = inter.action?.parameters?.flow_cta || "Abrir formulario";
      return bodyText + "\n[📅 Formulario de agendamiento: " + cta + "]";
    }
    return bodyText;
  }
  if (tipo === "image") return "[Imagen]";
  if (tipo === "video") return "[Video]";
  if (tipo === "document") return "[Documento]";
  return "[" + tipo + "]";
}

// guardarMensajeCliente — DEPRECATED, ya no se usa. 
// La escritura se unificó en doPost (entrada) y enviarMensajeWA (salida).

function traducirPayloadCliente(payload) {
  // Intentar obtener el título del botón desde la hoja Mensajes
  try {
    var ss = getDataSS();
    var msgs = cargarMensajes(ss);

    if (payload === "btn_menu_principal") return msg(msgs, "MSG_BTN_MENU") || "Menú principal";
    if (payload === "btn_confirmar_agendar") return msg(msgs, "BTN_CM") || "Ya agendé";
    if (payload === "btn_reconfirmar") return "Ya confirmé";
    if (payload === "btn_agendar_asesor") return msg(msgs, "MSG_BTN_AGENDAR_ASESOR") || "Agendar asesor";
    if (payload === "btn_2sem") return msg(msgs, "MSG_BTN_2SEM") || "2 semanas";
    if (payload === "btn_30dias") return msg(msgs, "MSG_BTN_30DIAS") || "30 días";
    if (payload === "btn_60dias") return msg(msgs, "MSG_BTN_60DIAS") || "60 días a más";

    var idLimpio = payload.replace("btn_", "");
    var asesores = cargarAsesoresBot(ss);

    // Botones de tecnología (btn_CLOUD, btn_IA, btn_EMPRESAS) → nombre de botón de la tecnología
    var techMatch = asesores.find(function(a) {
      var tid = (a.TECNOLOGIA_ID || a.TECNOLOGIA || "").toUpperCase().replace(/[^\w]/g, "").trim();
      return tid === idLimpio.toUpperCase();
    });
    if (techMatch && techMatch.TECNOLOGIA_NOMBRE_BOTON) return techMatch.TECNOLOGIA_NOMBRE_BOTON;
    var claveTitulo = "MSG_BTN_" + idLimpio.toUpperCase();
    var titulo = msg(msgs, claveTitulo);
    if (titulo !== claveTitulo) return titulo;

    // Botones de provider (btn_AWS, btn_AZURE, btn_GCP)
    var asesor = asesores.find(function(a) { return a.PROVIDER.toUpperCase() === idLimpio.toUpperCase(); });
    if (asesor && asesor.NOMBRE_BOTON) return asesor.NOMBRE_BOTON;

    // Certificaciones (cert_CLF, cert_SAA, etc.)
    if (payload.startsWith("cert_")) {
      var certId = payload.replace("cert_", "");
      var cursos = cargarCursosBot(ss);
      var curso = cursos.find(function(c) { return c.CERT_ID === certId; });
      if (curso) return curso.NOMBRE_CERT;
    }

    return idLimpio;
  } catch (e) {
    return payload.replace("btn_", "").replace("cert_", "");
  }
}

// ============================================================
// GOOGLE SHEETS — LEADS
// TELF|PROVIDER|CURSO|ACCION_BOT|ACCION_IA|TURNOS_IA|ESTADO_BOT|MEJOR_ESTADO_BOT|IA_ACTIVA|CREATED_AT|UPDATED_AT
// ============================================================
const BCOL = {
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

// Orden de progresión del flujo — de menor a mayor avance
const ORDEN_ESTADOS = [
  ESTADO.INICIO,
  ESTADO.NO_E_NUBE,
  ESTADO.NO_E_CERT,
  ESTADO.NO_E_URGENCIA,
  ESTADO.MAS_DE_60_DIAS,
  ESTADO.NO_CONFIRMO_MEET,
  ESTADO.CONFIRMO_MEET,
  ESTADO.RECONFIRMO_MEET,
  ESTADO.REMARKETING_FALLIDO
];

/**
 * Devuelve el estado más avanzado entre dos, según ORDEN_ESTADOS.
 * Si alguno no está en el orden, se conserva el actual.
 */
function mejorEstado(estadoActual, estadoNuevo) {
  const idxActual = ORDEN_ESTADOS.indexOf(estadoActual);
  const idxNuevo  = ORDEN_ESTADOS.indexOf(estadoNuevo);
  if (idxNuevo === -1) return estadoActual || estadoNuevo;
  if (idxActual === -1) return estadoNuevo;
  return idxNuevo > idxActual ? estadoNuevo : estadoActual;
}

function obtenerOCrearLead(ss, telefono) {
  telefono = (telefono || "").toString().trim();
  // Nunca crear un lead sin teléfono (evita filas fantasma en LEADS).
  if (!telefono) {
    logSheet("obtenerOCrearLead", "⚠️ WARNING", "Llamada con teléfono vacío, se ignora.");
    return { fila: 0, estado: ESTADO.INICIO, mejor_estado_bot: "", provider: "", curso: "", accion: "", turnos_ia: 0, ia_activa: true, bot_activo: true, es_nuevo: false };
  }
  const hoja = ss.getSheetByName("LEADS");
  console.log("🔍 Buscando hoja 'LEADS', encontrada: " + (hoja ? "SÍ" : "NO"));
  const data = hoja.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if ((data[i][BCOL.TELF] || "").toString().trim() === telefono) {
      return {
        fila:              i + 1,
        estado:            (data[i][BCOL.ESTADO_BOT] || "").toString().trim() || ESTADO.INICIO,
        mejor_estado_bot:  data[i][BCOL.MEJOR_ESTADO_BOT]?.toString().trim() || "",
        provider:          data[i][BCOL.PROVIDER].toString().trim(),
        curso:             data[i][BCOL.CURSO].toString().trim(),
        accion:            data[i][BCOL.ACCION_BOT].toString().trim(),
        turnos_ia:         parseInt(data[i][BCOL.TURNOS_IA]) || 0,
        ia_activa:         data[i][BCOL.IA_ACTIVA]?.toString().trim() !== "0",
        bot_activo:        data[i][BCOL.BOT_ACTIVO]?.toString().trim() !== "0",
        es_nuevo:          false
      };
    }
  }

  // Nueva fila: 12 columnas (CREATED_AT|UPDATED_AT|TELF|PROVIDER|CURSO|ACCION_BOT|ACCION_IA|TURNOS_IA|ESTADO_BOT|MEJOR_ESTADO_BOT|IA_ACTIVA|BOT_ACTIVO)
  hoja.appendRow([new Date(), new Date(), telefono, "", "", "", "", 0, ESTADO.INICIO, "", 1, 1]);
  return { fila: hoja.getLastRow(), estado: ESTADO.INICIO, mejor_estado_bot: "", provider: "", curso: "", accion: "", turnos_ia: 0, ia_activa: true, bot_activo: true, es_nuevo: true };
}

function actualizarLead(ss, telefono, campos) {
  const hoja = ss.getSheetByName("LEADS");
  const data = hoja.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][BCOL.TELF].toString().trim() === telefono) {
      const fila = i + 1;
      hoja.getRange(fila, BCOL.UPDATED_AT + 1).setValue(new Date());
      if (campos.estado_bot !== undefined) {
        hoja.getRange(fila, BCOL.ESTADO_BOT + 1).setValue(campos.estado_bot);
        const actual = data[i][BCOL.MEJOR_ESTADO_BOT]?.toString().trim() || "";
        const nuevo  = mejorEstado(actual, campos.estado_bot);
        if (nuevo !== actual) hoja.getRange(fila, BCOL.MEJOR_ESTADO_BOT + 1).setValue(nuevo);
      }
      if (campos.estado !== undefined) {
        hoja.getRange(fila, BCOL.ESTADO_BOT + 1).setValue(campos.estado);
        const actual = data[i][BCOL.MEJOR_ESTADO_BOT]?.toString().trim() || "";
        const nuevo  = mejorEstado(actual, campos.estado);
        if (nuevo !== actual) hoja.getRange(fila, BCOL.MEJOR_ESTADO_BOT + 1).setValue(nuevo);
      }
      if (campos.provider !== undefined) hoja.getRange(fila, BCOL.PROVIDER + 1).setValue(campos.provider);
      if (campos.curso    !== undefined) hoja.getRange(fila, BCOL.CURSO    + 1).setValue(campos.curso);
      if (campos.accion !== undefined) {
        // Acumular accion_bot — siempre concatenar
        const accionActual = data[i][BCOL.ACCION_BOT].toString().trim();
        const nuevaAccion  = accionActual ? accionActual + " > " + campos.accion : campos.accion;
        hoja.getRange(fila, BCOL.ACCION_BOT + 1).setValue(nuevaAccion);
      }
      // Columnas IA — acumular con " > "
      if (campos.accion_ia !== undefined) {
        const aiActual = data[i][BCOL.ACCION_IA]?.toString().trim() || "";
        const nuevaAI  = aiActual ? aiActual + " > " + campos.accion_ia : campos.accion_ia;
        hoja.getRange(fila, BCOL.ACCION_IA + 1).setValue(nuevaAI);
      }
      if (campos.turnos_ia !== undefined) hoja.getRange(fila, BCOL.TURNOS_IA + 1).setValue(campos.turnos_ia);
      if (campos.ia_activa !== undefined) hoja.getRange(fila, BCOL.IA_ACTIVA + 1).setValue(campos.ia_activa ? 1 : 0);
      if (campos.bot_activo !== undefined) hoja.getRange(fila, BCOL.BOT_ACTIVO + 1).setValue(campos.bot_activo ? 1 : 0);
      return;
    }
  }
}

function reiniciarLead(ss, telefono) {
  const hoja = ss.getSheetByName("LEADS");
  const data = hoja.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][BCOL.TELF].toString().trim() === telefono) {
      const fila         = i + 1;
      const accionPrevia = data[i][BCOL.ACCION_BOT].toString().trim();
      hoja.getRange(fila, BCOL.UPDATED_AT  + 1).setValue(new Date());
      hoja.getRange(fila, BCOL.PROVIDER    + 1).setValue("");
      hoja.getRange(fila, BCOL.ACCION_BOT  + 1).setValue(accionPrevia ? accionPrevia + " > reinicio" : "reinicio");
      hoja.getRange(fila, BCOL.ESTADO_BOT  + 1).setValue(ESTADO.INICIO);
      hoja.getRange(fila, BCOL.ACCION_IA   + 1).setValue("");
      return;
    }
  }
}

// ============================================================
// REENVÍO MASIVO — envía saludo a números con estado INICIO o NO_E_NUBE
// Ejecutar manualmente desde el editor una sola vez
// ============================================================
function reenviarSaludoPendientes() {
  const ss       = getDataSS();
  const hoja     = ss.getSheetByName("LEADS");
  const data     = hoja.getDataRange().getValues();
  const asesores = cargarAsesoresBot(ss);
  const msgs     = cargarMensajes(ss);
  let enviados   = 0;

  for (let i = 1; i < data.length; i++) {
    const estado = data[i][BCOL.ESTADO_BOT].toString().trim();
    const telf   = data[i][BCOL.TELF].toString().trim();
    if (!telf) continue;
    if (estado === ESTADO.INICIO || estado === ESTADO.NO_E_NUBE || estado === "") {
      enviarSaludo(telf, asesores, msgs);
      enviados++;
      Logger.log("✅ Saludo enviado a: " + telf);
      Utilities.sleep(500); // evitar rate limit
    }
  }
  Logger.log("Total enviados: " + enviados);
}
// Instalar con: instalarWarmupTrigger()
// ============================================================
function warmup() {
  // Función liviana que mantiene el script activo
  const ss = getDataSS();
  ss.getName();
}

function instalarWarmupTrigger() {
  // Eliminar triggers previos
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "warmup") ScriptApp.deleteTrigger(t);
  });
  // Ejecutar cada 5 minutos
  ScriptApp.newTrigger("warmup")
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log("✅ Warmup trigger instalado");
}
// ============================================================
// PRUEBA MANUAL — simula un mensaje entrante desde el editor
// Configura TEST_NUMBER en la hoja Config para usarlo
// ============================================================
function probarDoPost() {
  const cfg        = getProps();
  const testNumber = cfg["TEST_NUMBER"];
  if (!testNumber) {
    Logger.log("❌ Configura TEST_NUMBER en la hoja Config");
    return;
  }

  const payload = {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
      messages: [{
        id: "test_" + new Date().getTime(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        from: testNumber,
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "btn_menu_principal", title: "Menú principal" }
        }
      }]
    }
  };

  const fakeEvent = { postData: { contents: JSON.stringify(payload) } };
  const result = doPost(fakeEvent);
  Logger.log("Resultado: " + result.getContent());
}


// ============================================================
// CACHÉ — reduce lecturas al sheet en cada request
// ============================================================
function getCached(key, loader, ttl) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const data = loader();
  cache.put(key, JSON.stringify(data), ttl || 600); // default 10 minutos
  return data;
}

function cargarAsesoresBot(ss) {
  return getCached("asesores", () => {
    const hoja = ss.getSheetByName("ASESORES");
    if (!hoja) return [];
    const data    = hoja.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const result  = [];
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, j) => row[h] = data[i][j]?.toString().trim() || "");
      if (row.PROVIDER) result.push(row);
    }
    return result;
  });
}

function cargarCursosBot(ss) {
  return getCached("cursos", () => {
    const hoja = ss.getSheetByName("CURSOS");
    if (!hoja) return [];
    const data    = hoja.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const result  = [];
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, j) => row[h] = data[i][j]?.toString().trim() || "");
      if (row.CERT_ID) result.push(row);
    }
    return result;
  }, 60); // 1 minuto para reflejar cambios rápido
}

function cargarMensajes(ss) {
  return getCached("mensajes", () => {
    const msgs = {};

    // 1. Leer mensajes de texto desde la hoja principal "Mensajes"
    const hojaTextos = ss.getSheetByName("MENSAJES");
    if (hojaTextos) {
      const data = hojaTextos.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) msgs[data[i][0].toString().trim()] = data[i][1].toString();
      }
    }

    return msgs;
  });
}


// ============================================================
// LOGS — escribe en hoja Logs + consola de Apps Script
// ============================================================
function logSheet(funcion, nivel, mensaje) {
  Logger.log(nivel + " [" + funcion + "] " + mensaje);
  try {
    const ss   = getDataSS();
    const hoja = ss.getSheetByName("LOGS") || ss.getSheetByName("Logs");
    if (!hoja) return;
    hoja.appendRow([new Date(), funcion, nivel, mensaje]);
  } catch (e) {
    Logger.log("❌ logSheet error: " + e.message);
  }
}

// ============================================================
// UTILIDADES — ejecutar manualmente desde el editor
// ============================================================
function limpiarCache() {
  CacheService.getScriptCache().removeAll(["cursos", "asesores", "mensajes", "modalidades", "faq", "disparadores_bot", "flujo_bot"]);
  Logger.log("✅ Caché limpiado");
}

// ============================================================
// SEGUIMIENTO DATA-DRIVEN — lee seguimientos de la hoja FLUJO
// ============================================================
function procesarSeguimientoDataDriven(telf, estado, accion, accionFull, minutos, horas, fila, hoja, flujo, msgs, asesores, link, provider, ss, estadoGestion) {
  // Buscar el paso actual en el flujo
  let paso = flujo.find(p => p.estado === estado && p.activo !== false);
  if (!paso || !paso.seguimientos || !paso.seguimientos.length) return;

  // Evaluar cada seguimiento del paso
  for (const seg of paso.seguimientos) {
    if (!seg.tiempo || !seg.mensaje_clave) continue;

    // Parsear tiempo (ej: "30min", "2h", "18h")
    const tiempoMin = parsearTiempo(seg.tiempo);
    if (!tiempoMin) continue;

    // Generar marca de acción para este seguimiento
    const marca = "seg_" + estado.toLowerCase() + "_" + seg.tiempo.replace(/\s/g, "");

    // Verificar que no se haya enviado ya y que el tiempo se haya cumplido
    if (accion.includes(marca)) continue;
    if (minutos < tiempoMin) continue;
    // No enviar si pasaron más de 24h (evitar envíos acumulados)
    if (horas > 24) continue;

    // ── Remarketing condicional: si el seguimiento lleva a REMARKETING_FALLIDO
    //    desde un estado terminal positivo (CONFIRMO_MEET/RECONFIRMO_MEET),
    //    solo se envía si el asesor marcó ESTADO_GESTION = "remarketing".
    //    Así no se hace remarketing a quien sí asistió. ──
    if (
      (seg.estado_destino || "").toUpperCase() === "REMARKETING_FALLIDO" &&
      (estado === ESTADO.CONFIRMO_MEET || estado === ESTADO.RECONFIRMO_MEET) &&
      (estadoGestion || "").toString().trim().toLowerCase() !== "remarketing"
    ) {
      continue;
    }

    // Verificar que seguimientos previos de este paso se hayan enviado (son secuenciales)
    const segIdx = paso.seguimientos.indexOf(seg);
    if (segIdx > 0) {
      const segPrevio = paso.seguimientos[segIdx - 1];
      const marcaPrev = "seg_" + estado.toLowerCase() + "_" + segPrevio.tiempo.replace(/\s/g, "");
      if (!accion.includes(marcaPrev)) continue; // El anterior no se envió → no enviar este
    }

    // ── Enviar seguimiento ──
    // Resolver {PROVIDER} DENTRO de las claves antes de buscarlas en la hoja.
    // Las claves se guardan con placeholder (ej: MSG_SEG_NO_E_CERT_18H_{PROVIDER})
    // y la fila real en MENSAJES es MSG_SEG_NO_E_CERT_18H_AWS. Sin esto, msg()
    // no encuentra la clave y termina enviando la clave cruda con "{PROVIDER}".
    const provUpper = (provider || "").toString().toUpperCase().trim();
    const resolverClave = (clave) =>
      (clave || "").replace(/\{\{?PROVIDER\}?\}/gi, provUpper);

    // 1. Media si tiene
    const mediaClaveResuelta = resolverClave(seg.media_clave);
    if (mediaClaveResuelta) {
      const mediaVal = getMediaId(mediaClaveResuelta);
      if (mediaVal) {
        const tipoMedia = mediaClaveResuelta.includes("VID") ? "video" : "image";
        // Enviar SIN que enviarMensajeWA guarde "[Imagen]"; guardamos nosotros con
        // la referencia drive://<id>|clave para que el chat muestre la miniatura.
        enviarMediaSinGuardar(telf, mediaVal, tipoMedia);
        const driveId = getDriveIdByClave(mediaClaveResuelta);
        const contenidoMedia = driveId ? "drive://" + driveId + "|" + mediaClaveResuelta
                                        : "[" + (tipoMedia === "video" ? "Video" : "Imagen") + "]";
        guardarMensajeChat(ss, telf, "bot", tipoMedia, contenidoMedia);
        logSheet("seguimiento-media", "✅ OK", "Media enviada: " + mediaClaveResuelta + " (" + tipoMedia + " id=" + mediaVal + ") → " + telf);
        Utilities.sleep(300);
      } else {
        logSheet("seguimiento-media", "⚠️ WARNING", "media_clave sin Meta ID: " + mediaClaveResuelta + " → " + telf);
      }
    }

    // 2. Mensaje — resolver clave/placeholders
    let texto = resolverClave(seg.mensaje_clave);
    // Si empieza con MSG_ es clave, si no es texto directo
    if (texto.startsWith("MSG_")) {
      texto = msg(msgs, texto, { link: link }) || texto;
    }
    // Resolver placeholders del TEXTO final
    texto = texto.replace(/\{\{link\}\}/g, link).replace(/\{link\}/g, link);
    texto = texto.replace(/\{\{provider\}\}/g, provider).replace(/\{provider\}/g, provider);

    // Salvaguarda: si el texto sigue siendo una clave sin resolver (empieza con
    // "MSG_" o le quedó un placeholder "{...}"), NO enviar la clave cruda al cliente.
    // Se omite el seguimiento y se deja registro para corregir la config.
    if (texto.startsWith("MSG_") || /\{[^}]*\}/.test(texto)) {
      logSheet("seguimiento", "⚠️ WARNING",
        "Clave de seguimiento sin texto en MENSAJES, no se envía: " + telf +
        " | estado=" + estado + " | clave=" + seg.mensaje_clave + " | provider=" + (provider || "(vacío)"));
      return; // no marcar como enviado; se reintentará cuando exista el texto
    }

    // 3. Botones auto-inyectados según el estado del paso (CTA del seguimiento).
    //    El editor de flujo no configura botones en seguimientos, así que se
    //    derivan del estado igual que hacía el flujo hardcodeado.
    const botones = botonesSeguimiento(estado, seg, msgs);

    let res;
    if (botones.length) {
      res = enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telf,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto },
          action: { buttons: botones.slice(0, 3) }
        }
      });
    } else {
      res = enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telf,
        type: "text",
        text: { body: texto }
      });
    }

    // 4. Marcar como enviado + cambiar estado si aplica
    if (res && res.startsWith("200")) {
      hoja.getRange(fila, BCOL.ACCION_BOT + 1).setValue(accionFull + " > " + marca);
      if (seg.estado_destino) {
        hoja.getRange(fila, BCOL.ESTADO_BOT + 1).setValue(seg.estado_destino);
      }
      logSheet("seguimiento", "✅ OK", "Seg data-driven: " + telf + " | " + marca);
    } else {
      logSheet("seguimiento", "❌ ERROR", "Seg data-driven FALLÓ: " + telf + " | " + marca + " | " + res);
    }

    Utilities.sleep(300);
    return; // Solo enviar un seguimiento por ejecución
  }
}

/**
 * Deriva los botones (CTA) de un seguimiento a partir del estado del paso.
 * Reproduce el comportamiento del flujo hardcodeado sin exigir configuración
 * de botones en el editor de flujo:
 *   NO_CONFIRMO_MEET → "Ya agendé" (btn_confirmar_agendar)
 *   CONFIRMO_MEET    → "Confirmar reunión" (btn_reconfirmar)
 *   estado_destino terminal (REMARKETING_FALLIDO) → "Menú principal"
 *   otros con estado_destino / texto → sin botón (texto plano)
 */
function botonesSeguimiento(estado, seg, msgs) {
  const destino = (seg.estado_destino || "").toUpperCase();

  // Seguimiento que cierra en un estado terminal → ofrecer volver al menú
  if (destino === "REMARKETING_FALLIDO") {
    return [btn("btn_menu_principal", msg(msgs, "MSG_BTN_MENU") || "Menú principal")];
  }

  if (estado === ESTADO.NO_CONFIRMO_MEET) {
    return [btn("btn_confirmar_agendar", msg(msgs, "BTN_CM") || "Ya agendé")];
  }

  // CONFIRMO_MEET tiene 2 seguimientos: reconfirmación (con botón) y simulador (texto).
  // Solo el mensaje de reconfirmación lleva el botón "Confirmar reunión".
  if (estado === ESTADO.CONFIRMO_MEET) {
    const clave = (seg.mensaje_clave || "").toUpperCase();
    const esReconfirmacion = clave.includes("RECONFIRM") || clave.includes("30MIN_RC") || clave.includes("_RC");
    if (esReconfirmacion) {
      return [btn("btn_reconfirmar", msg(msgs, "MSG_BTN_RECONFIRM") || "Confirmar reunión")];
    }
    return [];
  }

  // Sin CTA específico → texto plano
  return [];
}

/**
 * Parsear tiempo del formato "30min", "2h", "18h" a minutos
 */
function parsearTiempo(str) {
  if (!str) return 0;
  str = str.trim().toLowerCase();
  if (str.endsWith("min")) return parseInt(str) || 0;
  if (str.endsWith("h")) return (parseInt(str) || 0) * 60;
  return parseInt(str) || 0;
}

// ============================================================
// SEGUIMIENTOS AUTOMÁTICOS — una sola función, trigger cada 30 min
//
// Ventanas de tiempo por estado:
//   NO_E_NUBE / NO_E_CERT / NO_E_URGENCIA → 18h  → MSG_SEG_18H_*  + btn_menu_principal
//
//   NO_CONFIRMO_MEET (flujo NCM):
//     30 min → video MSG_VID_SEG_NCM_30M + texto MSG_SEG_NCM_30M  + BTN_CM → seg_30min
//     2h     → video MSG_VID_SEG_NCM_2H  + texto MSG_SEG_NCM_2H   + BTN_CM → seg_2h
//     10h    → img   MSG_IMG_SEG_NCM_10H + texto MSG_SEG_NCM_10H  + BTN_CM → seg_10h
//     17h    → img   MSG_IMG_SEG_NCM_17H + texto MSG_SEG_NCM_17H  + BTN_CM → seg_17h
//     23h    → solo texto MSG_SEG_NCM_23H + btn_menu_principal → REMARKETING_FALLIDO → seg_23h
//
//   CONFIRMO_MEET → 30m  → MSG_SEG_30MIN_RC + btn_reconfirmar → seg_30min_reconfirm
//   CONFIRMO_MEET → 15h  → MSG_SEG_15H_SIMULADOR (texto)      → seg_15h_simulador
//   CONFIRMO_MEET / RECONFIRMO_MEET + estadoGestion=remarketing → 22h → MSG_REMARKETING → REMARKETING_FALLIDO
// ============================================================
function seguimiento30min() {
  const ss       = getDataSS();
  const hoja     = ss.getSheetByName("LEADS");
  if (!hoja) return;

  const data     = hoja.getDataRange().getValues();
  const headers  = (data[0] || []).map(h => h.toString().toUpperCase().trim());
  const colGestion = headers.indexOf("ESTADO_GESTION"); // -1 si la columna no existe aún
  const asesores = cargarAsesoresBot(ss);
  const msgs     = cargarMensajes(ss);
  const ahora    = new Date();
  const flujo    = cargarFlujoBot(); // Flujo data-driven (hoja FLUJO)

  for (let i = 1; i < data.length; i++) {
    const estado    = data[i][BCOL.ESTADO_BOT].toString().trim();
    const telf      = data[i][BCOL.TELF].toString().trim();
    const accionFull = data[i][BCOL.ACCION_BOT].toString().trim();
    const timestamp = data[i][BCOL.UPDATED_AT];
    const provider  = data[i][BCOL.PROVIDER].toString().trim();

    if (!telf) continue;
    if (!timestamp || !(timestamp instanceof Date)) continue;

    // ── Respetar el modo MANUAL: si un asesor desactivó el bot para este lead
    //    (BOT_ACTIVO = 0), NO enviar seguimientos automáticos.
    //    OJO: la celda puede ser el NÚMERO 0 (no string). No usar (valor || "")
    //    porque 0 es falsy → daría "" y el lead parecería activo por error.
    const botActivoRaw = data[i][BCOL.BOT_ACTIVO];
    const botActivo = (botActivoRaw === "" || botActivoRaw === null || botActivoRaw === undefined)
      ? true                                     // vacío = activo por defecto
      : botActivoRaw.toString().trim() !== "0";  // "0" o 0 → manual
    if (!botActivo) continue; // lead en modo manual → el asesor maneja la conversación

    // Para evaluar seguimientos, usar solo la parte de ACCION después del último reinicio
    const partes = accionFull.split(" > reinicio");
    const accion = partes[partes.length - 1];

    const minutos = (ahora - timestamp) / 60000;
    const horas   = minutos / 60;
    const fila    = i + 1;

    const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === provider.toUpperCase());
    const link   = asesor?.LINK_AGENDAMIENTO || "";

    // ESTADO_GESTION se lee por NOMBRE de encabezado (no por índice fijo).
    // Si la columna no existe, queda "" y el remarketing condicional no se dispara.
    const estadoGestion = colGestion >= 0 ? (data[i][colGestion] || "").toString().trim().toLowerCase() : "";

    // ══ FLUJO ÚNICO data-driven para TODOS los leads ══
    procesarSeguimientoDataDriven(telf, estado, accion, accionFull, minutos, horas, fila, hoja, flujo, msgs, asesores, link, provider, ss, estadoGestion);
  }
}

function instalarTriggerSeguimiento() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "seguimiento30min") ScriptApp.deleteTrigger(t);
  });
  // Apps Script limita a 20 triggers por proyecto.
  // Usamos everyMinutes(30) y dentro de seguimiento30min
  // verificamos que el minuto sea cercano a :00 o :30 para
  // simular ejecución en horas exactas.
  ScriptApp.newTrigger("seguimiento30min")
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log("✅ Trigger seguimiento instalado (cada 30 min)");
}

// ============================================================
// RESET DIARIO DE TURNOS IA — pone TURNOS_IA en 0 para todos los leads
// Ejecutar instalarTriggerResetTurnos() una vez para activar
// ============================================================
function resetearTurnosDiario() {
  const ss   = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) return;

  const data = hoja.getDataRange().getValues();
  let reseteados = 0;

  for (let i = 1; i < data.length; i++) {
    const turnos = parseInt(data[i][BCOL.TURNOS_IA]) || 0;
    if (turnos > 0) {
      hoja.getRange(i + 1, BCOL.TURNOS_IA + 1).setValue(0);
      reseteados++;
    }
  }

  if (reseteados > 0) {
    logSheet("resetearTurnosDiario", "✅ OK", "Turnos IA reseteados para " + reseteados + " leads");
  }
}

function instalarTriggerResetTurnos() {
  // Eliminar triggers existentes de esta función
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "resetearTurnosDiario") ScriptApp.deleteTrigger(t);
  });

  // Ejecutar todos los días a las 6:00 AM
  ScriptApp.newTrigger("resetearTurnosDiario")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  Logger.log("✅ Trigger reset turnos IA instalado (diario a las 6 AM)");
}



// ============================================================
// TEST — Ejecutar manualmente para diagnosticar envío de mensajes
// ============================================================
function testEnvio() {
  const props   = getProps();
  const token   = props["ACCESS_TOKEN"];
  const phoneId = props["PHONE_NUMBER_ID"];
  const numero  = props["TEST_NUMBER"];

  Logger.log("TOKEN: " + (token ? token.substring(0, 10) + "..." : "⚠️ VACÍO"));
  Logger.log("PHONE_ID: " + (phoneId || "⚠️ VACÍO"));
  Logger.log("NUMERO: " + (numero || "⚠️ VACÍO"));

  const payload = {
    messaging_product: "whatsapp",
    to: numero,
    type: "text",
    text: { body: "✅ Test desde Apps Script — conexión OK" }
  };

  const res = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/messages", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log("HTTP CODE: " + res.getResponseCode());
  Logger.log("RESPONSE: " + res.getContentText());
}
