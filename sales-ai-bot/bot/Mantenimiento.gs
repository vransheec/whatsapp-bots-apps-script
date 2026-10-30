// ============================================================
// Mantenimiento.gs — Funciones de corrección de datos (uso manual)
// Ejecutar desde el editor de Apps Script. NO se llaman desde el flujo.
// ============================================================

/**
 * Migra en la hoja LEADS todos los leads con ESTADO_BOT = "NO_E_TECNOLOGIA"
 * (estado legacy que ya no existe como paso en la hoja FLUJO) a "INICIO",
 * para que retomen el flujo actual administrado desde el front.
 *
 * Uso: seleccionar esta función en el editor de Apps Script y pulsar "Ejecutar".
 * Es idempotente: correrla varias veces no causa efectos adicionales.
 *
 * @returns {number} cantidad de filas modificadas
 */
function migrarEstadoNoETecnologiaAInicio() {
  const ESTADO_LEGACY = "NO_E_TECNOLOGIA";
  const ESTADO_NUEVO  = "INICIO";

  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) {
    Logger.log("❌ No se encontró la hoja LEADS.");
    return 0;
  }

  const data = hoja.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log("ℹ️ La hoja LEADS no tiene datos.");
    return 0;
  }

  // Resolver la columna ESTADO_BOT por su header (robusto ante cambios de orden).
  const headers = data[0].map(h => h.toString().trim().toUpperCase());
  let colEstado = headers.indexOf("ESTADO_BOT");
  if (colEstado === -1) {
    // Fallback al índice conocido del esquema actual (BCOL.ESTADO_BOT = 8).
    colEstado = 8;
    Logger.log("⚠️ No se encontró header 'ESTADO_BOT'; usando índice fijo 8.");
  }

  let modificados = 0;
  for (let i = 1; i < data.length; i++) {
    const estado = (data[i][colEstado] || "").toString().trim();
    if (estado === ESTADO_LEGACY) {
      hoja.getRange(i + 1, colEstado + 1).setValue(ESTADO_NUEVO);
      modificados++;
    }
  }

  Logger.log("✅ Migración completada. Leads actualizados de '" + ESTADO_LEGACY +
             "' a '" + ESTADO_NUEVO + "': " + modificados);
  return modificados;
}

// ============================================================
// PRUEBA — simula un doPost para un número cualquiera (no necesita ser test).
// Sirve para validar el código actual antes de desplegar, viendo en el log
// si responde o lanza una excepción.
//
// Uso: edita la constante TELEFONO_PRUEBA con un número real (formato
// internacional sin '+', p.ej. "51999888777") y ejecuta esta función.
// Enviará al bot un "Menú principal" simulado como ese número.
// ============================================================
function probarDoPostNumeroNormal() {
  const TELEFONO_PRUEBA = "000000000000"; // número de prueba

  const payload = {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
      messages: [{
        id: "test_" + new Date().getTime(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        from: TELEFONO_PRUEBA,
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "btn_menu_principal", title: "Menú principal" }
        }
      }]
    }
  };

  const fakeEvent = { postData: { contents: JSON.stringify(payload) } };
  try {
    const result = doPost(fakeEvent);
    Logger.log("✅ doPost ejecutó sin excepción. Respuesta HTTP simulada: " +
               (result && result.getContent ? result.getContent() : "(sin contenido)"));
    Logger.log("Revisa el WhatsApp del número de prueba y la hoja MENSAJES_CHAT para ver qué se envió.");
  } catch (e) {
    Logger.log("❌ doPost lanzó excepción: " + e.message + " | stack: " + e.stack);
  }
}

// ============================================================
// DIAGNÓSTICO — lista los nombres reales de las hojas del spreadsheet.
// Sirve para confirmar el casing exacto (ASESORES vs Asesores, etc.).
// Ejecutar desde el editor y revisar el Log.
// ============================================================
function listarNombresDeHojas() {
  const ss = getDataSS();
  const nombres = ss.getSheets().map(function(h){ return "'" + h.getName() + "'"; });
  Logger.log("Hojas del spreadsheet (" + nombres.length + "):\n" + nombres.join("\n"));
  return nombres;
}

// ============================================================
// DIAGNÓSTICO — muestra headers y primeras filas de una hoja.
// Editar NOMBRE_HOJA y ejecutar. Sirve para entender estructura de MODALIDADES/CURSOS.
// ============================================================
function inspeccionarHoja() {
  const NOMBRE_HOJA = "ASESORES"; // cambiar si se quiere inspeccionar otra
  const ss = getDataSS();
  const hoja = ss.getSheetByName(NOMBRE_HOJA);
  if (!hoja) { Logger.log("No existe la hoja " + NOMBRE_HOJA); return; }
  const data = hoja.getDataRange().getValues();
  Logger.log("HEADERS de " + NOMBRE_HOJA + ":\n" + JSON.stringify(data[0]));
  const muestra = data.slice(1, 9).map(function(r){ return JSON.stringify(r); });
  Logger.log("PRIMERAS FILAS (" + (data.length-1) + " en total):\n" + muestra.join("\n"));
}

// ============================================================
// DIAGNÓSTICO — valida la hoja FLUJO: JSON parseable, paso INICIO presente y activo.
// Ejecutar desde el editor y revisar el Log.
// ============================================================
function diagnosticarFlujo() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("FLUJO");
  if (!hoja) { Logger.log("❌ No existe la hoja FLUJO"); return; }
  const data = hoja.getDataRange().getValues();
  const estados = {};
  const pasos = [];
  for (let i = 1; i < data.length; i++) {
    const raw = data[i][0]?.toString() || "";
    if (!raw) continue;
    try { const p = JSON.parse(raw); pasos.push(p); estados[p.estado] = true; }
    catch (e) { Logger.log("❌ Fila " + (i+1) + " JSON inválido: " + e.message); }
  }
  // Detalle de cada paso + validación de que cada opcion.siguiente exista como paso
  pasos.forEach(function(p) {
    const opc = (p.opciones || []).map(function(o){
      const destinoExiste = !o.siguiente || estados[o.siguiente] ? "" : "  ⚠️ DESTINO INEXISTENTE";
      return "    · " + o.id + " → " + (o.siguiente || "(mismo)") + (o.titulo ? " [" + o.titulo + "]" : "") + destinoExiste;
    }).join("\n");
    // Rol: explícito si lo tiene, si no el inferido del nombre (retrocompat)
    const rolExplicito = p.rol ? "" : " (inferido)";
    const rol = p.rol || inferirRolPaso(p.estado);
    Logger.log("▶ " + p.estado + " | nombre=" + (p.nombre_amigable || "-") +
      " | ROL=" + rol + rolExplicito +
      " | tipo=" + p.tipo_mensaje + " | activo=" + p.activo + " | media=" + (p.media_clave||"-") +
      "\n" + (opc || "    (sin opciones)"));
  });
}

// ============================================================
// PRUEBA — simula que el lead toca un botón concreto (ej. btn_CLOUD).
// Reproduce el error que ocurre al procesar ese paso del flujo.
// Editar TELEFONO_PRUEBA y BOTON, ejecutar y revisar el Log (verás el error real).
// ============================================================
function probarBoton() {
  const TELEFONO_PRUEBA = "000000000000";
  // Cadena de botones a simular en secuencia (ajústala a tu flujo actual).
  // Flujo actual: Cloud → AWS → elegir certificación → (paso "agenda" → mensaje + Flow).
  const SECUENCIA = ["btn_CLOUD", "btn_AWS", "cert_CLF"];

  const ss = getDataSS();
  reiniciarLead(ss, TELEFONO_PRUEBA);
  Utilities.sleep(200);
  Logger.log("── Lead reiniciado a INICIO. Simulando cadena ──");

  for (var i = 0; i < SECUENCIA.length; i++) {
    const boton = SECUENCIA[i];
    try {
      procesarMensaje(TELEFONO_PRUEBA, boton, "interactive");
      // Leer el estado en que quedó el lead tras procesar
      const lead = obtenerOCrearLead(ss, TELEFONO_PRUEBA);
      Logger.log("✅ paso " + (i+1) + " | envié: " + boton + " → lead quedó en estado: " + lead.estado);
      Utilities.sleep(300);
    } catch (e) {
      Logger.log("❌ EXCEPCIÓN en paso " + (i+1) + " (botón " + boton + "): " + e.message + "\nSTACK:\n" + e.stack);
      return;
    }
  }
  Logger.log("── Fin de la cadena, sin excepciones ──");
}

// ============================================================
// PRUEBA — muestra las opciones efectivas (visibles) de un paso del flujo.
// Útil para verificar que el toggle de visibilidad (ocultar IA, etc.) funciona.
// ============================================================
function probarOpcionesDePaso() {
  const ESTADO_A_PROBAR = "NO_E_CERT"; // cambiar si se quiere otro paso
  const PROVIDER_PRUEBA = "AWS";       // simula el provider elegido (para NO_E_CERT)
  const ss = getDataSS();
  const asesores = cargarAsesoresBot(ss);
  const cursos = cargarCursosBot(ss);
  const msgs = cargarMensajes(ss);
  const flujo = cargarFlujoBot();
  const paso = buscarPasoFlujo(flujo, ESTADO_A_PROBAR);
  if (!paso) { Logger.log("No existe el paso " + ESTADO_A_PROBAR); return; }
  const leadSimulado = { provider: PROVIDER_PRUEBA };
  const efectivas = obtenerOpcionesEfectivas(paso, cursos, asesores, msgs, leadSimulado);
  Logger.log("Opciones VISIBLES de " + ESTADO_A_PROBAR + " (provider=" + PROVIDER_PRUEBA + ") → " + efectivas.length + ":");
  efectivas.forEach(function(o){ Logger.log("  · " + o.id + " → " + o.siguiente + " [" + o.tituloResuelto + "]"); });
}

// ============================================================
// DIAGNÓSTICO — disparadores (filas DISP_ de la hoja MENSAJES).
// Muestra el valor REAL de la columna G (activo) de cada disparador
// y lo compara con lo que el bot está viendo en caché.
// Ejecutar desde el editor y revisar el Log.
// ============================================================
function diagnosticarDisparadores() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES");
  if (!hoja) { Logger.log("❌ No existe la hoja MENSAJES"); return; }

  const data = hoja.getDataRange().getValues();
  Logger.log("═══ HOJA MENSAJES — filas DISP_ (valor real) ═══");
  let encontrados = 0;
  for (let i = 1; i < data.length; i++) {
    const clave = (data[i][0] || "").toString().trim();
    if (!clave.startsWith("DISP_")) continue;
    encontrados++;
    const gRaw    = data[i][6];
    const activo  = (gRaw === "" || gRaw === null || gRaw === undefined)
      ? "1 (vacío → activo por defecto)"
      : gRaw.toString().trim();
    const estado  = (activo === "0") ? "🔴 DESACTIVADO" : "🟢 ACTIVO";
    const palabras = (data[i][4] || "").toString();
    Logger.log(
      "Fila " + (i+1) + " | " + clave + " | col G=[" + JSON.stringify(gRaw) + "] → " + estado +
      "\n    palabras: " + palabras
    );
  }
  if (!encontrados) Logger.log("(no hay filas DISP_ en la hoja)");

  Logger.log("\n═══ LO QUE VE EL BOT (cargarDisparadoresBot, incluye caché) ═══");
  const enBot = cargarDisparadoresBot();
  if (!enBot.length) {
    Logger.log("(el bot no tiene disparadores activos cargados)");
  } else {
    enBot.forEach(function(d) {
      Logger.log("🟢 " + d.clave + " | palabras: " + JSON.stringify(d.palabras));
    });
  }
  Logger.log(
    "\n⚠️ Si un disparador aparece DESACTIVADO en la hoja pero SÍ aparece en la lista del bot, " +
    "es caché viejo. Ejecuta limpiarCache() y vuelve a correr este diagnóstico."
  );
}

// ============================================================
// DIAGNÓSTICO — últimos mensajes de un número (hoja MENSAJES_CHAT).
// Sirve para ver QUÉ mensaje entrante provocó cada respuesta del bot
// (ej. por qué el saludo INICIO se reenvió "de la nada").
// Editar TELEFONO y ejecutar; revisar el Log.
// Columnas MENSAJES_CHAT: TIMESTAMP | TELF | ORIGEN | TIPO | CONTENIDO
// ============================================================
function diagnosticarConversacion() {
  // Coincidencia por los últimos 9 dígitos, así no importa el prefijo (+51, 51, etc.)
  const TELEFONO = "910263928";
  const CUANTOS  = 25;            // últimos N mensajes

  const ss = getDataSS();
  const hoja = ss.getSheetByName("MENSAJES_CHAT");
  if (!hoja) { Logger.log("❌ No existe la hoja MENSAJES_CHAT"); return; }

  const data = hoja.getDataRange().getValues();

  // Diagnóstico extra: listar todos los números distintos que existen en la hoja.
  const numeros = {};
  for (let i = 1; i < data.length; i++) {
    const t = (data[i][1] || "").toString().trim();
    if (t) numeros[t] = (numeros[t] || 0) + 1;
  }
  Logger.log("═══ Números en MENSAJES_CHAT (número → # mensajes) ═══");
  Object.keys(numeros).forEach(function(t){ Logger.log("  " + t + " → " + numeros[t]); });
  Logger.log("");

  const soloDigitos = function(s){ return (s || "").toString().replace(/\D/g, ""); };
  const objetivo = soloDigitos(TELEFONO);

  const filas = [];
  for (let i = 1; i < data.length; i++) {
    const telf = soloDigitos(data[i][1]);
    if (!telf.endsWith(objetivo)) continue;
    filas.push({
      ts:        data[i][0],
      origen:    (data[i][2] || "").toString().trim(),
      tipo:      (data[i][3] || "").toString().trim(),
      contenido: (data[i][4] || "").toString().trim()
    });
  }

  if (!filas.length) { Logger.log("(sin mensajes para " + TELEFONO + ")"); return; }

  const ultimos = filas.slice(-CUANTOS);
  Logger.log("═══ Últimos " + ultimos.length + " mensajes de " + TELEFONO + " ═══");
  ultimos.forEach(function(m) {
    const fecha = (m.ts instanceof Date)
      ? Utilities.formatDate(m.ts, "America/Lima", "dd/MM HH:mm:ss")
      : m.ts;
    const flecha = (m.origen === "lead") ? "⬅️ LEAD " : "➡️ BOT  ";
    const txt = m.contenido.length > 90 ? m.contenido.substring(0, 90) + "…" : m.contenido;
    Logger.log(fecha + " | " + flecha + " | " + m.tipo + " | " + txt);
  });
  Logger.log("\n👉 Fíjate qué mensaje del LEAD (⬅️) aparece justo ANTES de cada saludo del BOT.");
}

// ============================================================
// DIAGNÓSTICO — inspecciona una fila de LEADS para un teléfono.
// Muestra headers reales, sus índices, y el valor crudo de cada columna,
// para verificar que BOT_ACTIVO se lee/escribe en la columna correcta.
// Editar TELEFONO y ejecutar; revisar el Log.
// ============================================================
function diagnosticarLead() {
  const TELEFONO = "51983430470"; // sin "+"
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) { Logger.log("❌ No existe LEADS"); return; }
  const data = hoja.getDataRange().getValues();
  const headers = data[0];

  Logger.log("═══ HEADERS de LEADS (índice → nombre) ═══");
  headers.forEach((h, j) => Logger.log("  [" + j + "] " + h));
  Logger.log("\nBCOL.BOT_ACTIVO = " + BCOL.BOT_ACTIVO + "  (lo que el bot lee como bot activo)");
  Logger.log("BCOL.ESTADO_BOT = " + BCOL.ESTADO_BOT + " | BCOL.TELF = " + BCOL.TELF);

  const soloDig = (s) => (s || "").toString().replace(/\D/g, "");
  const objetivo = soloDig(TELEFONO);
  for (let i = 1; i < data.length; i++) {
    if (soloDig(data[i][BCOL.TELF]).endsWith(objetivo)) {
      Logger.log("\n═══ Fila " + (i+1) + " del lead " + TELEFONO + " ═══");
      headers.forEach((h, j) => {
        Logger.log("  [" + j + "] " + h + " = " + JSON.stringify(data[i][j]));
      });
      const _ba = data[i][BCOL.BOT_ACTIVO];
      const botActivo = (_ba === "" || _ba === null || _ba === undefined) ? true : _ba.toString().trim() !== "0";
      Logger.log("\n→ El bot lee BOT_ACTIVO (col " + BCOL.BOT_ACTIVO + ") = " +
        JSON.stringify(data[i][BCOL.BOT_ACTIVO]) + " → botActivo=" + botActivo +
        (botActivo ? "  ⚠️ ENVIARÁ seguimientos" : "  ✅ NO enviará (manual)"));
      return;
    }
  }
  Logger.log("(no se encontró el lead " + TELEFONO + ")");
}

// ============================================================
// DIAGNÓSTICO — media de los seguimientos.
// Recorre todos los pasos del flujo y sus seguimientos, y verifica si
// cada media_clave existe y getMediaId() la resuelve a un Meta ID.
// Ejecutar desde el editor y revisar el Log.
// ============================================================
// Detecta claves DUPLICADAS en IMAGENES_FLUJO y muestra qué Meta ID tiene cada fila.
// getMediaId lee la PRIMERA coincidencia, así que un duplicado con ID viejo arriba
// hace que el bot use el ID equivocado aunque la re-subida haya escrito uno nuevo.
function diagnosticarDuplicadosMedia() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("IMAGENES_FLUJO");
  if (!hoja) { Logger.log("❌ No existe IMAGENES_FLUJO"); return; }
  const data = hoja.getDataRange().getValues();
  const porClave = {};
  for (let i = 1; i < data.length; i++) {
    const clave = (data[i][2] || "").toString().trim();
    if (!clave) continue;
    if (!porClave[clave]) porClave[clave] = [];
    porClave[clave].push({ fila: i + 1, metaId: data[i][5], driveId: (data[i][3]||"").toString().trim() });
  }
  Logger.log("═══ Claves en IMAGENES_FLUJO (duplicados marcados) ═══");
  Object.keys(porClave).sort().forEach(function(clave) {
    const filas = porClave[clave];
    const dup = filas.length > 1 ? "  ⚠️ DUPLICADA (" + filas.length + " filas)" : "";
    Logger.log("▶ " + clave + dup);
    filas.forEach(function(f) {
      Logger.log("    fila " + f.fila + " | Meta ID = " + JSON.stringify(f.metaId));
    });
  });
  Logger.log("\n(getMediaId usa la PRIMERA fila de cada clave. Si hay duplicados con ID viejo arriba, el bot usa el viejo.)");
}

function diagnosticarMediaSeguimientos() {
  const flujo = cargarFlujoBot();
  const PROVIDERS_PRUEBA = ["AWS", "AZURE", "GCP", "IA"]; // para resolver {PROVIDER}
  let total = 0;

  flujo.forEach(function(p) {
    const segs = p.seguimientos || [];
    segs.forEach(function(seg) {
      if (!seg.media_clave) return;
      total++;
      Logger.log("▶ Paso " + p.estado + " | seguimiento tiempo=" + seg.tiempo +
        " | media_clave=" + seg.media_clave);
      // Probar la clave tal cual y resolviendo {PROVIDER}
      const claves = [];
      if (/\{\{?PROVIDER\}?\}/i.test(seg.media_clave)) {
        PROVIDERS_PRUEBA.forEach(function(pr) {
          claves.push(seg.media_clave.replace(/\{\{?PROVIDER\}?\}/gi, pr));
        });
      } else {
        claves.push(seg.media_clave);
      }
      claves.forEach(function(c) {
        const id = getMediaId(c);
        Logger.log("    · " + c + " → " + (id ? ("✅ Meta ID: " + id) : "❌ SIN Meta ID (no se enviará)"));
      });
    });
  });

  if (!total) Logger.log("(ningún seguimiento tiene media_clave configurada)");
}

// ============================================================
// PRUEBA — fuerza el envío de UNA media de seguimiento a tu número,
// para ver en vivo si Meta la acepta o devuelve error.
// Editar TELEFONO y CLAVE. Revisar Log + hoja LOGS.
// ============================================================
function probarEnvioMediaSeguimiento() {
  const TELEFONO = "000000000000";
  const CLAVE    = "MSG_VID_SEG_NCM_30M"; // cambiar por la media_clave a probar
  const mediaVal = getMediaId(CLAVE);
  if (!mediaVal) { Logger.log("❌ No se encontró Meta ID para " + CLAVE); return; }
  const tipoMedia = CLAVE.includes("VID") ? "video" : "image";
  Logger.log("Enviando " + tipoMedia + " (id=" + mediaVal + ") a " + TELEFONO + "...");
  const res = enviarMedia(TELEFONO, mediaVal, tipoMedia);
  Logger.log("Resultado: " + res);
}

// ============================================================
// RE-SUBIDA MASIVA DE MEDIA A META
// Para cada fila de IMAGENES_FLUJO: toma el Drive ID (col D), descarga el
// archivo de Drive, lo sube a Meta /media (WABA actual) y escribe el nuevo
// Meta ID en col F. Útil cuando los Meta IDs quedaron inválidos tras cambiar
// de WABA/número. Ejecutar desde el editor y revisar el Log.
//
// Columnas IMAGENES_FLUJO: C(2)=CLAVE | D(3)=DRIVE_ID | F(5)=META_ID
// ============================================================
function resubirMediaAMeta() {
  const SOLO_SEGUIMIENTOS = false; // true = solo claves que contengan "SEG"; false = todas
  const cfg = getProps();
  const token = cfg["ACCESS_TOKEN"] || cfg["WA_TOKEN"];
  const phoneId = cfg["PHONE_NUMBER_ID"] || cfg["WA_PHONE_ID"];
  if (!token || !phoneId) { Logger.log("❌ Faltan ACCESS_TOKEN / PHONE_NUMBER_ID"); return; }

  const ss = getDataSS();
  const hoja = ss.getSheetByName("IMAGENES_FLUJO");
  if (!hoja) { Logger.log("❌ No existe IMAGENES_FLUJO"); return; }
  const data = hoja.getDataRange().getValues();

  let ok = 0, fallo = 0, saltadas = 0;
  for (let i = 1; i < data.length; i++) {
    const clave   = (data[i][2] || "").toString().trim();
    const driveId = (data[i][3] || "").toString().trim();
    if (!clave) continue;
    if (SOLO_SEGUIMIENTOS && clave.toUpperCase().indexOf("SEG") === -1) { saltadas++; continue; }
    if (!driveId) { Logger.log("⚠️ " + clave + " sin Drive ID, se salta"); saltadas++; continue; }

    try {
      // Descargar el archivo de Drive (trae su content type real)
      const blob = DriveApp.getFileById(driveId).getBlob();
      const mime = blob.getContentType();

      const res = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + phoneId + "/media", {
        method: "post",
        headers: { Authorization: "Bearer " + token },
        payload: { messaging_product: "whatsapp", type: mime, file: blob },
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const body = res.getContentText();
      if (code === 200) {
        const nuevoId = JSON.parse(body).id;
        // Escribir el nuevo Meta ID en col F (índice 5 → columna 6). Como texto para
        // evitar notación científica.
        hoja.getRange(i + 1, 6).setValue("'" + nuevoId);
        Logger.log("✅ " + clave + " → nuevo Meta ID: " + nuevoId + " (" + mime + ")");
        ok++;
      } else {
        Logger.log("❌ " + clave + " → error " + code + ": " + body.substring(0, 150));
        fallo++;
      }
      Utilities.sleep(400);
    } catch (e) {
      Logger.log("❌ " + clave + " → excepción: " + e.message);
      fallo++;
    }
  }

  // Limpiar cache de media para que el bot use los nuevos IDs
  try { CacheService.getScriptCache().removeAll(["mensajes"]); } catch(e) {}
  Logger.log("\n── Resumen: " + ok + " OK, " + fallo + " fallidas, " + saltadas + " saltadas ──");
  Logger.log("Nota: el cache de getMediaId es por clave (media_<clave>, TTL 10s). Espera unos segundos antes de probar envío.");
}

// ============================================================
// DIAGNÓSTICO — salud de la hoja LEADS.
// Revisa las últimas N filas: si TELF está presente, si hay filas vacías o
// con columnas corridas, y cuántos leads sin TELF existen en total.
// Ejecutar desde el editor y revisar el Log.
// ============================================================
function diagnosticarLeadsSalud() {
  const N = 15; // últimas filas a inspeccionar en detalle
  const ss = getDataSS();
  const hoja = ss.getSheetByName("LEADS");
  if (!hoja) { Logger.log("❌ No existe LEADS"); return; }
  const data = hoja.getDataRange().getValues();
  const headers = data[0];

  Logger.log("═══ HEADERS (" + headers.length + " columnas) ═══");
  Logger.log(headers.map((h, j) => "[" + j + "]" + h).join(" | "));

  // Conteo global de filas sin TELF (posibles basura/duplicados)
  let sinTelf = 0, conTelf = 0;
  for (let i = 1; i < data.length; i++) {
    const t = (data[i][BCOL.TELF] || "").toString().trim();
    if (t) conTelf++; else sinTelf++;
  }
  Logger.log("\nTotal filas: " + (data.length - 1) + " | con TELF: " + conTelf + " | SIN TELF: " + sinTelf +
    (sinTelf > 0 ? "  ⚠️ hay filas sin teléfono" : "  ✅"));

  Logger.log("\n═══ Últimas " + N + " filas (fila | TELF | ESTADO | PROVIDER | CURSO | CREATED) ═══");
  const ini = Math.max(1, data.length - N);
  for (let i = ini; i < data.length; i++) {
    const telf    = (data[i][BCOL.TELF] || "").toString().trim();
    const estado  = (data[i][BCOL.ESTADO_BOT] || "").toString().trim();
    const prov    = (data[i][BCOL.PROVIDER] || "").toString().trim();
    const curso   = (data[i][BCOL.CURSO] || "").toString().trim();
    const created = data[i][BCOL.CREATED_AT];
    const flag = telf ? "" : "  ⚠️ SIN TELF";
    Logger.log("fila " + (i+1) + " | TELF=" + (telf || "(vacío)") + " | " + estado +
      " | prov=" + (prov||"-") + " | curso=" + (curso||"-") + " | " + created + flag);
  }
}
