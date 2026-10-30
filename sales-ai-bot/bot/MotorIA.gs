// ============================================================
// MotorIA.gs — Módulo de IA para calificación de leads
// Modelo: DeepSeek-V4-Flash vía API directa
// Se activa SOLO cuando el lead escribe texto libre (no botón)
// ============================================================

// ============================================================
// CONFIGURACIÓN
// ============================================================
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL    = "deepseek-chat"; // deepseek-v4-flash
const MAX_TURNOS_IA     = 4;

function getDeepSeekKey() {
  return PropertiesService.getScriptProperties().getProperty("DEEPSEEK_API_KEY");
}

// ============================================================
// PROMPT DINÁMICO — lee desde hoja Prompts con rollout gradual
// ============================================================
function obtenerPromptActivo(telefono) {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("PROMPTS");
  if (!hoja) return SYSTEM_PROMPT_FALLBACK;

  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return SYSTEM_PROMPT_FALLBACK;

  // Buscar la versión con mayor rollout que aplique a este lead
  // Lógica: hash del teléfono % 100 → si cae dentro del rollout, usa esa versión
  // Se recorren las versiones de la más nueva a la más vieja
  const hash = Math.abs(telefono.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 100;

  for (let i = data.length - 1; i >= 1; i--) {
    const rollout = parseInt(data[i][2]) || 0;
    if (hash < rollout) {
      return data[i][1]?.toString() || SYSTEM_PROMPT_FALLBACK;
    }
  }

  // Si ninguna versión aplica, usar la primera (la más vieja con 100%)
  return data[1][1]?.toString() || SYSTEM_PROMPT_FALLBACK;
}

// Fallback por si la hoja Prompts no existe o está vacía
const SYSTEM_PROMPT_FALLBACK = "Eres Nova, asistente de WhatsApp de Cloud Academy. Responde siempre con la función responder_lead.";

// ============================================================
// SCHEMA DEL TOOL — responder_lead
// ============================================================
const RESPONDER_LEAD_SCHEMA = {
  type: "function",
  function: {
    name: "responder_lead",
    description: "Analiza el/los mensaje(s) pendientes del lead y devuelve la accion a ejecutar, junto con los datos que se puedan resolver del mensaje y el texto de respuesta.",
    parameters: {
      type: "object",
      properties: {
        accion: {
          type: "string",
          enum: ["responder_faq", "avanzar_estado", "pedir_aclaracion", "fuera_de_tema"],
          description: "La unica accion a ejecutar para este turno."
        },
        nube: {
          type: ["string", "null"],
          enum: ["AWS", "AZURE", "GCP", null],
          description: "Nube identificada en el mensaje actual. Null si no aplica o ya estaba resuelta."
        },
        cert_id: {
          type: ["string", "null"],
          description: "CERT_ID exacto identificado sin ambiguedad. Null si no se puede resolver."
        },
        urgencia_detectada: {
          type: ["string", "null"],
          enum: ["btn_2sem", "btn_30dias", "btn_60dias", null],
          description: "Urgencia mapeada. Null si no aplica."
        },
        confirmacion_detectada: {
          type: ["string", "null"],
          description: "Codigo de boton que el mensaje confirma implicitamente. Null si no aplica."
        },
        texto: {
          type: "string",
          description: "Texto de respuesta para el lead en formato WhatsApp."
        }
      },
      required: ["accion", "texto"]
    }
  }
};

// ============================================================
// SYSTEM PROMPT — ya no se usa hardcodeado, se lee de la hoja Prompts
// La constante se mantiene solo como referencia/fallback
// ============================================================


// ============================================================
// MAPEO estado_bot → opciones_pendientes
// ============================================================
function obtenerOpcionesPendientes(estado, lead, cursos) {
  switch (estado) {
    case ESTADO.INICIO:
      return ["btn_CLOUD", "btn_IA", "btn_EMPRESAS"];
    case ESTADO.NO_E_NUBE:
      return ["btn_AWS", "btn_AZURE", "btn_GCP"];
    case ESTADO.NO_E_CERT: {
      const provider = lead.provider || "";
      const certs = cursos.filter(c => c.PROVIDER.toUpperCase() === provider.toUpperCase());
      return certs.map(c => "cert_" + c.CERT_ID);
    }
    case ESTADO.NO_E_URGENCIA:
      return ["btn_2sem", "btn_30dias", "btn_60dias"];
    case ESTADO.NO_CONFIRMO_MEET:
      return ["btn_confirmar_agendar"];
    case ESTADO.CONFIRMO_MEET:
      return ["btn_reconfirmar"];
    case ESTADO.RECONFIRMO_MEET:
      return [];
    default:
      return [];
  }
}


// ============================================================
// ARMADO DEL CONTEXTO DINÁMICO
// ============================================================
function armarContextoIA(lead, payload, cursos, asesores, ss) {
  const estado   = lead.estado || ESTADO.INICIO;
  const provider = lead.provider || "";
  const certId   = lead.curso ? buscarCertIdPorNombre(lead.curso, cursos) : null;
  const cache    = CacheService.getScriptCache();

  // Opciones pendientes
  const opciones = obtenerOpcionesPendientes(estado, lead, cursos);

  // Última respuesta IA (de cache)
  const ultimaRespIA = cache.get("ultima_respuesta_ia_" + lead.fila) || "";

  // Historial respondido (de cache)
  const historialRaw = cache.get("historial_respondido_" + lead.fila);
  const historial    = historialRaw ? JSON.parse(historialRaw) : [];

  // Catálogo filtrado
  const catalogo = armarCatalogoFiltrado(provider, certId, cursos, asesores, ss);

  return {
    estado_bot: estado.toLowerCase(),
    nube_ya_resuelta: provider || null,
    cert_id: certId || null,
    urgencia_ya_resuelta: null, // se llena si el lead ya pasó urgencia
    opciones_pendientes: opciones,
    ultima_respuesta_ia: ultimaRespIA,
    historial_respondido: historial,
    mensajes_pendientes: [payload],
    catalogo: catalogo
  };
}

function buscarCertIdPorNombre(nombreCert, cursos) {
  const curso = cursos.find(c => c.NOMBRE_CERT === nombreCert);
  return curso ? curso.CERT_ID : null;
}

// ============================================================
// CATÁLOGO FILTRADO — solo lo relevante para el lead
// ============================================================
function armarCatalogoFiltrado(provider, certId, cursos, asesores, ss) {
  const catalogo = { cursos: [], modalidades: [], faq_aplicable: [], asesor: null };

  // Cursos: si hay cert_id → solo ese; si hay provider → todos de ese provider; si no → mini-índice
  if (certId) {
    catalogo.cursos = cursos.filter(c => c.CERT_ID === certId).map(simplificarCurso);
  } else if (provider) {
    catalogo.cursos = cursos.filter(c => c.PROVIDER.toUpperCase() === provider.toUpperCase()).map(simplificarCurso);
  } else {
    // Solo nombres y providers para orientar (sin detalles)
    catalogo.cursos = cursos.map(c => ({ cert_id: c.CERT_ID, provider: c.PROVIDER, nombre: c.NOMBRE_CERT }));
  }

  // Modalidades: solo si hay cert_id o provider
  if (certId || provider) {
    const modalidades = cargarModalidades(ss);
    if (certId) {
      catalogo.modalidades = modalidades.filter(m => m.CERT_ID === certId);
    } else {
      const certIds = cursos.filter(c => c.PROVIDER.toUpperCase() === provider.toUpperCase()).map(c => c.CERT_ID);
      catalogo.modalidades = modalidades.filter(m => certIds.includes(m.CERT_ID));
    }
  }

  // FAQ: filtrar por provider (ALL + el provider del lead)
  const faq = cargarFAQ(ss);
  if (provider) {
    catalogo.faq_aplicable = faq.filter(f =>
      f.APLICA_A === "ALL" || f.APLICA_A.toUpperCase() === provider.toUpperCase()
    );
  } else {
    catalogo.faq_aplicable = faq.filter(f => f.APLICA_A === "ALL");
  }

  // Asesor
  if (provider) {
    const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === provider.toUpperCase());
    if (asesor) {
      catalogo.asesor = { nombre: asesor.ASESOR || asesor.NOMBRE || "", link_agendamiento: asesor.LINK_AGENDAMIENTO || "" };
    }
  }

  return catalogo;
}

function simplificarCurso(c) {
  return {
    cert_id: c.CERT_ID,
    provider: c.PROVIDER,
    nombre: c.NOMBRE_CERT,
    duracion_horas: c.DURACION_HORAS || "",
    sesiones: c.SESIONES || "",
    horas_en_vivo: c.HORAS_EN_VIVO || "",
    horas_offline: c.HORAS_OFFLINE || "",
    dias_clase: c.DIAS_CLASE || "",
    horario: c.HORARIO || ""
  };
}


// ============================================================
// CARGA DE HOJAS NUEVAS (Modalidades, FAQ) CON CACHE
// ============================================================
function cargarModalidades(ss) {
  return getCached("modalidades", () => {
    const hoja = ss.getSheetByName("MODALIDADES");
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
  }, 300); // 5 minutos
}

function cargarFAQ(ss) {
  return getCached("faq", () => {
    const hoja = ss.getSheetByName("FAQ");
    if (!hoja) return [];
    const data    = hoja.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const result  = [];
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, j) => row[h] = data[i][j]?.toString().trim() || "");
      if (row.TEMA) result.push(row);
    }
    return result;
  }, 300); // 5 minutos
}


// ============================================================
// LLAMADO A DEEPSEEK
// ============================================================
function llamarDeepSeek(contexto, promptActivo) {
  const apiKey = getDeepSeekKey();
  if (!apiKey) {
    logSheet("MotorIA", "❌ ERROR", "DEEPSEEK_API_KEY no configurada en PropertiesService");
    return null;
  }

  const payload = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: promptActivo },
      { role: "user", content: JSON.stringify(contexto) }
    ],
    tools: [RESPONDER_LEAD_SCHEMA],
    tool_choice: "required",
    temperature: 0.4
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const startTime = Date.now();

  try {
    const resp     = UrlFetchApp.fetch(DEEPSEEK_ENDPOINT, options);
    const elapsed  = Date.now() - startTime;
    const code     = resp.getResponseCode();
    const bodyText = resp.getContentText();

    console.log("🤖 DeepSeek respuesta en " + elapsed + "ms | code: " + code);

    if (code !== 200) {
      logSheet("MotorIA", "❌ ERROR", "DeepSeek HTTP " + code + ": " + bodyText.substring(0, 200));
      return null;
    }

    // Timeout check: si tardó más de 5s, loguear warning
    if (elapsed > 5000) {
      logSheet("MotorIA", "⚠️ WARNING", "DeepSeek tardó " + elapsed + "ms para lead");
    }

    const data     = JSON.parse(bodyText);
    const message  = data.choices?.[0]?.message;

    if (!message?.tool_calls || !message.tool_calls.length) {
      logSheet("MotorIA", "❌ ERROR", "DeepSeek no devolvió tool_call: " + bodyText.substring(0, 200));
      return null;
    }

    const toolCall = message.tool_calls[0];
    const args     = JSON.parse(toolCall.function.arguments);
    return args;

  } catch (e) {
    const elapsed = Date.now() - startTime;
    logSheet("MotorIA", "❌ ERROR", "DeepSeek excepción (" + elapsed + "ms): " + e.message);
    return null;
  }
}


// ============================================================
// VALIDACIÓN Y WHITELIST
// ============================================================
const ACCIONES_VALIDAS    = ["responder_faq", "avanzar_estado", "pedir_aclaracion", "fuera_de_tema"];
const URGENCIAS_VALIDAS   = ["btn_2sem", "btn_30dias", "btn_60dias"];
const NUBES_VALIDAS       = ["AWS", "AZURE", "GCP"];

function validarRespuestaIA(respuesta, cursos) {
  if (!respuesta || typeof respuesta !== "object") { console.log("❌ Validación: respuesta no es objeto"); return false; }
  if (!ACCIONES_VALIDAS.includes(respuesta.accion)) { console.log("❌ Validación: accion inválida: " + respuesta.accion); return false; }
  if (!respuesta.texto || respuesta.texto.trim() === "") { console.log("❌ Validación: texto vacío"); return false; }

  // Validar nube si viene
  if (respuesta.nube && !NUBES_VALIDAS.includes(respuesta.nube)) { console.log("❌ Validación: nube inválida: " + respuesta.nube); return false; }

  // Validar cert_id si viene
  if (respuesta.cert_id) {
    const existe = cursos.some(c => c.CERT_ID === respuesta.cert_id);
    if (!existe) { console.log("❌ Validación: cert_id no existe: " + respuesta.cert_id + " | disponibles: " + cursos.map(c => c.CERT_ID).join(",")); return false; }
  }

  // Validar urgencia si viene
  if (respuesta.urgencia_detectada && !URGENCIAS_VALIDAS.includes(respuesta.urgencia_detectada)) { console.log("❌ Validación: urgencia inválida: " + respuesta.urgencia_detectada); return false; }

  return true;
}


// ============================================================
// CONTADOR DE TURNOS — persistente en el sheet (columna TURNOS_IA)
// ============================================================
function obtenerTurnosIA(lead) {
  return lead.turnos_ia || 0;
}

function incrementarTurnosIA(ss, telefono, turnosActuales) {
  const nuevoValor = turnosActuales + 1;
  actualizarLead(ss, telefono, { turnos_ia: nuevoValor });
  return nuevoValor;
}

// ============================================================
// MEMORIA CORTA — última respuesta IA e historial
// ============================================================
function guardarUltimaRespuestaIA(leadId, texto) {
  const cache = CacheService.getScriptCache();
  // Truncar a 4000 chars para no exceder límites de cache
  cache.put("ultima_respuesta_ia_" + leadId, texto.substring(0, 4000), 21600);
}

function guardarEnHistorial(leadId, mensaje, accion) {
  const cache      = CacheService.getScriptCache();
  const key        = "historial_respondido_" + leadId;
  const raw        = cache.get(key);
  const historial  = raw ? JSON.parse(raw) : [];

  historial.push({ mensaje: mensaje, accion: accion });

  // Mantener solo últimos 5
  while (historial.length > 5) historial.shift();

  const serialized = JSON.stringify(historial);
  // Validar tamaño antes de cachear (límite 100KB)
  if (serialized.length < 90000) {
    cache.put(key, serialized, 21600);
  }
}


// ============================================================
// FUNCIÓN PRINCIPAL — procesarConIA
// Llamada desde procesarMensajeFlujoNuevo (texto libre) en Bot.gs
// ============================================================
function procesarConIA(telefono, payload, lead, ss, asesores, cursos, msgs) {
  // Marcar todos los envíos salientes de este turno como origen "ia" en MENSAJES_CHAT.
  // Se restaura a "bot" en el finally, pase lo que pase.
  _origenSaliente = "ia";
  try {
    return _procesarConIA_interno(telefono, payload, lead, ss, asesores, cursos, msgs);
  } finally {
    _origenSaliente = "bot";
  }
}

function _procesarConIA_interno(telefono, payload, lead, ss, asesores, cursos, msgs) {
  const leadId = String(lead.fila);
  const estado = lead.estado || ESTADO.INICIO;

  // ── Verificar límite de turnos (persistente en sheet) ──
  // Solo los números de prueba (marcha blanca) tienen turnos de IA ilimitados.
  const esMarcha = esNumeroTest(telefono);
  const turnosActuales = obtenerTurnosIA(lead);
  if (!esMarcha && turnosActuales >= MAX_TURNOS_IA) {
    // Derivar a asesor humano
    const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === (lead.provider || "").toUpperCase());
    const link   = asesor?.LINK_AGENDAMIENTO || "";
    const textoDerivacion = msg(msgs, "MSG_DERIVACION_IA", { link });

    enviarTexto(telefono, textoDerivacion);
    actualizarLead(ss, telefono, { accion: "ia_limite_turnos_derivado" });
    logSheet("MotorIA", "⚠️ LIMITE", "Lead " + telefono + " alcanzó " + MAX_TURNOS_IA + " turnos IA sin avanzar. Derivado a asesor.");
    return true;
  }

  // ── Incrementar contador (persistente en sheet) — solo si no es marcha blanca ──
  if (!esMarcha) {
    incrementarTurnosIA(ss, telefono, turnosActuales);
  }

  // ── Armar contexto ──
  const contexto = armarContextoIA(lead, payload, cursos, asesores, ss);

  // ── Obtener prompt activo (desde hoja Prompts, con rollout) ──
  const promptActivo = obtenerPromptActivo(telefono);

  // ── Llamar a DeepSeek ──
  const respuesta = llamarDeepSeek(contexto, promptActivo);

  // ── Validar respuesta ──
  if (!validarRespuestaIA(respuesta, cursos)) {
    logSheet("MotorIA", "❌ ERROR", "Respuesta IA inválida para " + telefono + ": " + JSON.stringify(respuesta)?.substring(0, 300));
    enviarErrorOpciones(telefono, msgs);
    return false;
  }

  // ── Ejecutar acción ──
  const exito = ejecutarAccionIA(respuesta, telefono, lead, ss, asesores, cursos, msgs);

  // ── Guardar en sheet: accion_ia (sin escribir MENSAJES_CHAT — ya lo hace enviarMensajeWA) ──
  if (exito) {
    actualizarLead(ss, telefono, {
      accion_ia: respuesta.accion
    });
    logSheet("MotorIA", "✅ OK", telefono + " | accion: " + respuesta.accion + " | texto: " + respuesta.texto.substring(0, 100));
  }

  // ── Guardar memoria corta ──
  if (exito) {
    guardarUltimaRespuestaIA(leadId, respuesta.texto);
    guardarEnHistorial(leadId, payload, respuesta.accion);
  }

  return exito;
}


// ============================================================
// EJECUTAR ACCIÓN — según lo que devolvió la IA
// ============================================================
function ejecutarAccionIA(respuesta, telefono, lead, ss, asesores, cursos, msgs) {
  const accion = respuesta.accion;

  switch (accion) {

    case "responder_faq":
      // Enviar texto de la IA + re-mostrar botones del estado actual
      enviarTexto(telefono, respuesta.texto);
      Utilities.sleep(300);
      enviarBotonesEstadoActual(telefono, lead, ss, asesores, cursos, msgs);
      actualizarLead(ss, telefono, { accion: "ia_faq" });
      return true;

    case "pedir_aclaracion":
      // Enviar pregunta aclaratoria + re-mostrar botones del estado actual
      enviarTexto(telefono, respuesta.texto);
      Utilities.sleep(300);
      enviarBotonesEstadoActual(telefono, lead, ss, asesores, cursos, msgs);
      actualizarLead(ss, telefono, { accion: "ia_aclaracion" });
      return true;

    case "fuera_de_tema":
      // Enviar respuesta de redirección + re-mostrar botones del estado actual
      enviarTexto(telefono, respuesta.texto);
      Utilities.sleep(300);
      enviarBotonesEstadoActual(telefono, lead, ss, asesores, cursos, msgs);
      actualizarLead(ss, telefono, { accion: "ia_fuera_tema" });
      return true;

    case "avanzar_estado":
      return ejecutarAvanzarEstado(respuesta, telefono, lead, ss, asesores, cursos, msgs);

    default:
      return false;
  }
}

// ============================================================
// AVANZAR ESTADO — inyecta datos resueltos y deja que el flujo
// determinístico normal decida el siguiente mensaje
// ============================================================
function ejecutarAvanzarEstado(respuesta, telefono, lead, ss, asesores, cursos, msgs) {
  const estado = lead.estado || ESTADO.INICIO;

  // ── Confirmación implícita de botón ──
  if (respuesta.confirmacion_detectada) {
    enviarTexto(telefono, respuesta.texto);
    Utilities.sleep(300);
    procesarMensajeFlujoNuevo(telefono, respuesta.confirmacion_detectada, "interactive");
    actualizarLead(ss, telefono, { accion: "ia_confirmacion_" + respuesta.confirmacion_detectada });
    return true;
  }

  // ── Resolver nube ──
  if (respuesta.nube && !lead.provider) {
    // Si también tiene cert_id, resolver ambos
    if (respuesta.cert_id) {
      const curso = cursos.find(c => c.CERT_ID === respuesta.cert_id);
      if (curso) {
        enviarTexto(telefono, respuesta.texto);
        Utilities.sleep(300);
        actualizarLead(ss, telefono, { provider: respuesta.nube, estado: ESTADO.NO_E_CERT, accion: "ia_nube_" + respuesta.nube });
        procesarMensajeFlujoNuevo(telefono, "cert_" + respuesta.cert_id, "interactive");
        return true;
      }
    }

    // Solo nube sin cert → actualizar estado a NO_E_NUBE y simular selección de provider
    actualizarLead(ss, telefono, { estado: ESTADO.NO_E_NUBE, accion: "ia_nube_" + respuesta.nube });
    procesarMensajeFlujoNuevo(telefono, "btn_" + respuesta.nube, "interactive");
    return true;
  }

  // ── Resolver cert_id (nube ya resuelta) ──
  if (respuesta.cert_id && lead.provider && estado === ESTADO.NO_E_CERT) {
    enviarTexto(telefono, respuesta.texto);
    Utilities.sleep(300);
    procesarMensajeFlujoNuevo(telefono, "cert_" + respuesta.cert_id, "interactive");
    actualizarLead(ss, telefono, { accion: "ia_cert_" + respuesta.cert_id });
    return true;
  }

  // ── Resolver urgencia ──
  if (respuesta.urgencia_detectada && estado === ESTADO.NO_E_URGENCIA) {
    enviarTexto(telefono, respuesta.texto);
    Utilities.sleep(300);
    procesarMensajeFlujoNuevo(telefono, respuesta.urgencia_detectada, "interactive");
    actualizarLead(ss, telefono, { accion: "ia_urgencia_" + respuesta.urgencia_detectada });
    return true;
  }

  // ── Si no se pudo mapear a ningún avance concreto, enviar solo el texto de la IA ──
  enviarTexto(telefono, respuesta.texto);
  actualizarLead(ss, telefono, { accion: "ia_avanzar_sin_match" });
  return true;
}

// ============================================================
// DETERMINAR ESTADO AVANZADO — para saber si resetear turnos
// ============================================================
function determinarEstadoAvanzado(respuesta, estadoActual) {
  if (respuesta.confirmacion_detectada === "btn_confirmar_agendar") return ESTADO.CONFIRMO_MEET;
  if (respuesta.confirmacion_detectada === "btn_reconfirmar") return ESTADO.RECONFIRMO_MEET;
  if (respuesta.urgencia_detectada) return ESTADO.NO_CONFIRMO_MEET;
  if (respuesta.cert_id) return ESTADO.NO_E_URGENCIA;
  if (respuesta.nube) return ESTADO.NO_E_CERT;
  return estadoActual;
}


// ============================================================
// ENVIAR BOTONES DEL ESTADO ACTUAL — re-muestra las opciones
// interactivas del paso en que se encuentra el lead después de
// que la IA responde con texto (FAQ, aclaración, fuera de tema)
// ============================================================
function enviarBotonesEstadoActual(telefono, lead, ss, asesores, cursos, msgs) {
  // Si está desactivado desde el panel, no enviar
  if (msgs["_ACTIVO_MSG_ELIGE_OPCION"] === "0") return;

  const estado = lead.estado || ESTADO.INICIO;

  switch (estado) {

    case ESTADO.INICIO: {
      // Botones de tecnología: id ← TECNOLOGIA_ID, texto ← TECNOLOGIA_NOMBRE_BOTON (con fallbacks).
      const vistosTech = {};
      const botones = [];
      asesores.forEach(a => {
        if (botones.length >= 3) return; // WhatsApp máx. 3 botones
        const techId = (a.TECNOLOGIA_ID || a.TECNOLOGIA || "").toUpperCase().replace(/[^\w]/g, "").trim();
        if (!techId || vistosTech[techId]) return;
        vistosTech[techId] = true;
        let titulo = a.TECNOLOGIA_NOMBRE_BOTON || "";
        if (!titulo) {
          const claveTitulo = "MSG_BTN_" + techId;
          titulo = msg(msgs, claveTitulo) !== claveTitulo ? msg(msgs, claveTitulo) : techId;
        }
        botones.push({ type: "reply", reply: { id: "btn_" + techId, title: titulo.substring(0, 20) } });
      });
      enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telefono,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: msg(msgs, "MSG_ELIGE_OPCION") || "Elige la que más te interese:" },
          action: { buttons: botones }
        }
      });
      break;
    }

    case ESTADO.NO_E_NUBE: {
      // Mostrar botones de providers (AWS, AZURE, GCP) de la tecnología del lead.
      const filaLead = asesores.find(a => a.PROVIDER.toUpperCase() === (lead.provider || "").toUpperCase());
      const techLead = ((filaLead && (filaLead.TECNOLOGIA_ID || filaLead.TECNOLOGIA)) || "CLOUD").toUpperCase().replace(/[^\w]/g, "").trim();
      const asesoresDeTech = asesores.filter(a => ((a.TECNOLOGIA_ID || a.TECNOLOGIA) || "").toUpperCase().replace(/[^\w]/g, "").trim() === techLead);
      const providersConCursos = [...new Set(asesoresDeTech.map(a => a.PROVIDER.toUpperCase()))]
        .filter(p => cursos.some(c => c.PROVIDER.toUpperCase() === p));
      const botones = providersConCursos.slice(0, 3).map(p => ({
        type: "reply",
        reply: { id: "btn_" + p, title: (asesores.find(a => a.PROVIDER.toUpperCase() === p)?.NOMBRE_BOTON || p).substring(0, 20) }
      }));
      if (botones.length) {
        enviarMensajeWA({
          messaging_product: "whatsapp",
          to: telefono,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: msg(msgs, "MSG_ELIGE_OPCION") || "Elige la que más te interese:" },
            action: { buttons: botones }
          }
        });
      }
      break;
    }

    case ESTADO.NO_E_CERT: {
      // Re-mostrar lista de certificaciones
      const provider = lead.provider || "";
      const certsDeProv = cursos.filter(c => c.PROVIDER.toUpperCase() === provider.toUpperCase());
      if (certsDeProv.length) {
        enviarListaCertificaciones(telefono, provider, certsDeProv, msgs);
      }
      break;
    }

    case ESTADO.NO_E_URGENCIA: {
      // Re-mostrar botones de tiempo
      enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telefono,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: msg(msgs, "MSG_ELIGE_OPCION") || "Elige la que más te interese:" },
          action: {
            buttons: [
              btn("btn_2sem",   msg(msgs, "MSG_BTN_2SEM")   || "2 semanas"),
              btn("btn_30dias", msg(msgs, "MSG_BTN_30DIAS") || "30 días"),
              btn("btn_60dias", msg(msgs, "MSG_BTN_60DIAS") || "60 días a más")
            ]
          }
        }
      });
      break;
    }

    case ESTADO.NO_CONFIRMO_MEET: {
      // Re-mostrar botón de "Ya agendé"
      const asesor = asesores.find(a => a.PROVIDER.toUpperCase() === (lead.provider || "").toUpperCase());
      const link   = asesor?.LINK_AGENDAMIENTO || "";
      enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telefono,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: msg(msgs, "MSG_ELIGE_OPCION") || "Elige una opción:" },
          action: {
            buttons: [
              btn("btn_confirmar_agendar", msg(msgs, "BTN_CM") || "Ya agendé"),
              btn("btn_menu_principal",    msg(msgs, "MSG_BTN_MENU") || "Menú principal")
            ]
          }
        }
      });
      break;
    }

    default:
      // Para estados terminales o no mapeados, ofrecer volver al menú
      enviarMensajeWA({
        messaging_product: "whatsapp",
        to: telefono,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: msg(msgs, "MSG_ELIGE_OPCION") || "Elige una opción:" },
          action: {
            buttons: [
              btn("btn_menu_principal", msg(msgs, "MSG_BTN_MENU") || "Menú principal")
            ]
          }
        }
      });
      break;
  }
}
