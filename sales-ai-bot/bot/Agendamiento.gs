// ============================================================
// AGENDAMIENTO CON WHATSAPP FLOWS
// El cliente agenda su asesoría dentro de WhatsApp (sin salir a Calendly).
// - Los horarios se calculan leyendo el Google Calendar del asesor.
// - Se envía un Flow con los slots libres inyectados como opciones.
// - Al completar el Flow, se revalida el slot bajo lock y se crea el evento.
// ============================================================

// ── Configuración ──
const FLOW_ID_AGENDA   = "1728251688463464";   // Flow en Meta (Publicado, WABA del bot)
// "draft" mientras el Flow NO está publicado (para probar). "published" en producción.
const FLOW_MODE        = "published";
const AGENDA_TZ        = "America/Lima";        // GMT-5
// Calendario organizador (cuenta Workspace @example.com). El evento + la Meet se crean
// aquí; esto habilita leer la asistencia a la videollamada vía Reports API. Al asesor
// asignado (por provider, hoja ASESORES col CORREO_ASESOR) se le invita al evento.
const AGENDA_CAL_EMAIL  = "contact@example.com";

// ── Valores por DEFECTO (se usan si la hoja CONFIG_AGENDA no existe o falta algún dato).
// La config real es editable desde el panel (página "Flow") → hoja CONFIG_AGENDA.
const AGENDA_DURACION_DEFAULT = 20;   // duración de la asesoría (min)
const AGENDA_BUFFER_DEFAULT   = 5;    // descanso entre reuniones (min)
const AGENDA_DIAS_DEFAULT     = 5;    // próximos N días corridos
// Horario por día (0=Dom..6=Sáb): [horaIni, minIni, horaFin, minFin] o null = cerrado.
const AGENDA_HORARIO_DEFAULT = {
  0: null,
  1: [11, 0, 19, 30],
  2: [11, 0, 19, 30],
  3: [11, 0, 19, 30],
  4: [11, 0, 19, 30],
  5: [11, 0, 18, 30],
  6: [10, 0, 12, 30]
};

// Lee la config de agendamiento desde la hoja CONFIG_AGENDA (clave-valor), con cache.
// Formato de la hoja: CLAVE | VALOR
//   DURACION_MIN=20, BUFFER_MIN=5, DIAS=5
//   HORARIO_0..HORARIO_6 = "HH:MM-HH:MM" o "cerrado"/"" (0=Dom..6=Sáb)
function cargarConfigAgenda() {
  return getCached("config_agenda", () => {
    const cfg = {
      duracion: AGENDA_DURACION_DEFAULT,
      buffer:   AGENDA_BUFFER_DEFAULT,
      dias:     AGENDA_DIAS_DEFAULT,
      horario:  JSON.parse(JSON.stringify(AGENDA_HORARIO_DEFAULT))
    };
    const ss = getDataSS();
    const hoja = ss.getSheetByName("CONFIG_AGENDA");
    if (!hoja) return cfg;
    const data = hoja.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const clave = (data[i][0] || "").toString().trim().toUpperCase();
      const val = (data[i][1] || "").toString().trim();
      if (!clave) continue;
      if (clave === "DURACION_MIN") { const n = parseInt(val, 10); if (n > 0) cfg.duracion = n; }
      else if (clave === "BUFFER_MIN") { const n = parseInt(val, 10); if (n >= 0) cfg.buffer = n; }
      else if (clave === "DIAS") { const n = parseInt(val, 10); if (n > 0) cfg.dias = n; }
      else if (clave.indexOf("HORARIO_") === 0) {
        const dia = parseInt(clave.replace("HORARIO_", ""), 10);
        if (dia >= 0 && dia <= 6) {
          const low = val.toLowerCase();
          if (!val || low === "cerrado") { cfg.horario[dia] = null; }
          else {
            // Formato "HH:MM-HH:MM"
            const m = val.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
            if (m) cfg.horario[dia] = [parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10), parseInt(m[4],10)];
          }
        }
      }
    }
    return cfg;
  }, 30); // cache 30s
}

// ============================================================
// CÁLCULO DE SLOTS DISPONIBLES
// Devuelve [{ id: ISO-8601, title: "Mar 30 Sep · 11:00 am" }, ...]
// leyendo los eventos del calendario del asesor para no ofrecer horas ocupadas.
// ============================================================
function calcularSlotsDisponibles() {
  const cal = CalendarApp.getCalendarById(AGENDA_CAL_EMAIL);
  if (!cal) {
    logSheet("agenda", "❌ ERROR", "No se pudo acceder al calendario " + AGENDA_CAL_EMAIL);
    return [];
  }

  // Config editable desde el panel (duración, buffer, días, horario por día)
  const cfg = cargarConfigAgenda();
  const duracion = cfg.duracion;
  const paso = cfg.duracion + cfg.buffer;      // separación entre inicios de slot
  const bufferMs = cfg.buffer * 60000;
  const nDias = cfg.dias;

  const ahora = new Date();
  const finVentana = new Date(ahora.getTime() + nDias * 24 * 60 * 60 * 1000);
  const eventos = cal.getEvents(ahora, finVentana);

  const slots = [];
  const diasNombre = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const mesesNombre = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  for (let d = 0; d < nDias; d++) {
    const dia = new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);
    const diaSemana = parseInt(Utilities.formatDate(dia, AGENDA_TZ, "u"), 10) % 7; // Dom=0..Sáb=6
    const horario = cfg.horario[diaSemana];
    if (!horario) continue; // día cerrado

    const yyyy = Utilities.formatDate(dia, AGENDA_TZ, "yyyy");
    const mm   = Utilities.formatDate(dia, AGENDA_TZ, "MM");
    const dd   = Utilities.formatDate(dia, AGENDA_TZ, "dd");

    let bloqueInicio = crearFechaLocal(yyyy, mm, dd, horario[0], horario[1]);
    const bloqueFinDia = crearFechaLocal(yyyy, mm, dd, horario[2], horario[3]);

    while (bloqueInicio.getTime() + duracion * 60000 <= bloqueFinDia.getTime()) {
      const bloqueFin = new Date(bloqueInicio.getTime() + duracion * 60000);

      if (bloqueInicio.getTime() > ahora.getTime()) {
        const ocupado = eventos.some(ev =>
          bloqueInicio.getTime() < ev.getEndTime().getTime() + bufferMs &&
          bloqueFin.getTime() > ev.getStartTime().getTime() - bufferMs
        );
        if (!ocupado) {
          const diaLabel = diasNombre[diaSemana];
          const mesLabel = mesesNombre[parseInt(mm, 10) - 1];
          const hora12 = Utilities.formatDate(bloqueInicio, AGENDA_TZ, "h:mm a")
            .replace("AM", "am").replace("PM", "pm");
          slots.push({
            id: fechaAISO(bloqueInicio),
            title: diaLabel + " " + parseInt(dd, 10) + " " + mesLabel + " · " + hora12
          });
        }
      }
      bloqueInicio = new Date(bloqueInicio.getTime() + paso * 60000);
    }
  }
  return slots;
}

// Crea un Date que representa la hora local GMT-5 indicada.
// GMT-5 fijo (no hay DST en Perú), así que se arma el ISO con offset -05:00.
function crearFechaLocal(yyyy, mm, dd, hora, min) {
  const iso = yyyy + "-" + mm + "-" + dd + "T" +
    ("0" + hora).slice(-2) + ":" + ("0" + min).slice(-2) + ":00-05:00";
  return new Date(iso);
}

// Formatea un Date a ISO con offset -05:00 (para usar como id del slot)
function fechaAISO(fecha) {
  return Utilities.formatDate(fecha, AGENDA_TZ, "yyyy-MM-dd'T'HH:mm:ss") + "-05:00";
}

// ============================================================
// ENVÍO DEL FLOW DE AGENDAMIENTO
// Reemplaza el envío del link de Calendly.
// ============================================================
// TEXTOS DEL AGENDAMIENTO — fuente única: hoja MENSAJES (claves MSG_AGENDA_*).
// Se editan desde la página "Agendamiento" del panel. Aquí solo defaults de respaldo.
// ============================================================
const AGENDA_TEXTOS_DEFAULT = {
  MSG_AGENDA_FLOW_BODY:   "📅 Reserva tu asesoría\n\nElige el horario que más te convenga y completa tus datos. ¡Es rápido!",
  MSG_AGENDA_FLOW_CTA:    "Agendar ahora",
  MSG_AGENDA_CONFIRMADA:  "¡Listo! ✅ Tu asesoría quedó agendada para:\n\n📅 {{fecha}}\n\nTe llegará un correo de confirmación. ¡Nos vemos! 🚀",
  MSG_AGENDA_SLOT_OCUPADO:"¡Uy! Ese horario acaba de ocuparse 😅. Aquí tienes los horarios disponibles ahora, por favor elige otro 👇",
  MSG_AGENDA_SIN_CUPOS:   "Por ahora no tengo horarios disponibles 😔. Escríbeme más tarde y con gusto te agendo.",
  MSG_AGENDA_ERROR_SLOT:  "No pude leer el horario elegido 🤔. Te reenvío las opciones.",
  MSG_AGENDA_ERROR_CAL:   "Tuve un problema con el calendario 😔. Intenta de nuevo en un momento."
};

// Devuelve el texto de una clave MSG_AGENDA_* desde MENSAJES, o su default.
function textoAgenda(msgs, clave) {
  var t = msgs ? msg(msgs, clave) : "";
  if (!t || t === clave) t = AGENDA_TEXTOS_DEFAULT[clave] || "";
  return t;
}

function enviarFlowAgendamiento(telefono, msgs) {
  // Asegurar que tengamos los textos (si no vino msgs, cargarlos)
  if (!msgs) { try { msgs = cargarMensajes(getDataSS()); } catch (e) { msgs = null; } }
  const slots = calcularSlotsDisponibles();

  if (!slots.length) {
    enviarTexto(telefono, textoAgenda(msgs, "MSG_AGENDA_SIN_CUPOS"));
    return false;
  }

  // WhatsApp Flows limita los data-source; recortar a 20 por seguridad de tamaño.
  const slotsFlow = slots.slice(0, 20);
  const flowToken = "agenda_" + telefono + "_" + Date.now();

  const payload = {
    messaging_product: "whatsapp",
    to: telefono,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: textoAgenda(msgs, "MSG_AGENDA_FLOW_BODY") },
      action: {
        name: "flow",
        parameters: (function() {
          const p = {
            flow_message_version: "3",
            flow_token: flowToken,
            flow_id: FLOW_ID_AGENDA,
            flow_cta: textoAgenda(msgs, "MSG_AGENDA_FLOW_CTA"),
            flow_action: "navigate",
            flow_action_payload: {
              screen: "AGENDAR",
              data: { slots: slotsFlow }
            }
          };
          if (FLOW_MODE === "draft") p.mode = "draft";
          return p;
        })()
      }
    }
  };

  const res = enviarMensajeWA(payload);
  return res && res.toString().startsWith("200");
}

// ============================================================
// RECEPCIÓN DE LA RESPUESTA DEL FLOW (nfm_reply)
// Se llama desde doPost cuando interactive.type === "nfm_reply".
// Revalida el slot bajo lock y crea el evento o pide reintentar.
// ============================================================
function procesarRespuestaFlow(telefono, nfmReply, ss, msgs) {
  let datos;
  try {
    datos = JSON.parse(nfmReply.response_json || "{}");
  } catch (e) {
    logSheet("agenda", "❌ ERROR", "response_json inválido: " + e.message);
    return;
  }

  // El Flow de "cerrar" manda flow_token sin datos útiles; ignorar si no hay slot.
  const slotISO = (datos.slot || "").toString().trim();
  const nombre  = (datos.nombre || "").toString().trim();
  const correo  = (datos.correo || "").toString().trim();
  if (!slotISO) return;

  const inicio = new Date(slotISO);
  if (isNaN(inicio.getTime())) {
    enviarTexto(telefono, textoAgenda(msgs, "MSG_AGENDA_ERROR_SLOT"));
    enviarFlowAgendamiento(telefono, msgs);
    return;
  }
  // Config dinámica (duración + buffer) desde el panel.
  const cfgAg = cargarConfigAgenda();
  const fin = new Date(inicio.getTime() + cfgAg.duracion * 60000);

  // ── Revalidación + creación bajo lock (evita doble reserva del mismo slot) ──
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cal = CalendarApp.getCalendarById(AGENDA_CAL_EMAIL);
    if (!cal) {
      enviarTexto(telefono, textoAgenda(msgs, "MSG_AGENDA_ERROR_CAL"));
      return;
    }

    // ¿Sigue libre el slot, respetando el buffer de descanso entre reuniones?
    // Se consulta un rango ampliado por el buffer y se exige separación mínima.
    const bufferMs = cfgAg.buffer * 60000;
    const ocupados = cal.getEvents(new Date(inicio.getTime() - bufferMs), new Date(fin.getTime() + bufferMs));
    const chocando = ocupados.some(ev =>
      inicio.getTime() < ev.getEndTime().getTime() + bufferMs &&
      fin.getTime() > ev.getStartTime().getTime() - bufferMs);

    if (chocando) {
      // El horario ya fue tomado entre que vio los slots y confirmó → pedir otro
      enviarTexto(telefono, textoAgenda(msgs, "MSG_AGENDA_SLOT_OCUPADO"));
      enviarFlowAgendamiento(telefono, msgs);
      return;
    }

    // Crear el evento e invitar al cliente
    const lead = obtenerOCrearLead(ss, telefono);
    const tituloEvento = "Asesoría Cloud Academy — " + (nombre || telefono);
    const descripcion =
      "Asesoría agendada por WhatsApp.\n" +
      "Cliente: " + (nombre || "-") + "\n" +
      "Teléfono: " + telefono + "\n" +
      "Correo: " + (correo || "-") + "\n" +
      "Provider: " + (lead.provider || "-") + "\n" +
      "Curso: " + (lead.curso || "-");

    // Correo del asesor asignado por provider (hoja ASESORES). Se invita al evento.
    const asesoresAg = cargarAsesoresBot(ss);
    const asesorAg = asesoresAg.find(a => (a.PROVIDER || "").toUpperCase() === (lead.provider || "").toUpperCase());
    const correoAsesor = asesorAg ? (asesorAg.CORREO_ASESOR || "").trim() : "";

    // Crear el evento CON Google Meet usando la Advanced Calendar Service (Calendar API).
    // CalendarApp no puede generar un Meet link; la Calendar API sí (conferenceData).
    const creado = crearEventoConMeet(AGENDA_CAL_EMAIL, {
      titulo: tituloEvento, descripcion: descripcion,
      inicio: inicio, fin: fin, correo: correo, correoAsesor: correoAsesor
    });
    const eventoId = creado.eventoId || "";
    const meetLink = creado.meetLink || "";
    const meetCode = creado.meetCode || "";

    // Guardar en la hoja AGENDAMIENTOS (incluye el link y el código de la Meet)
    guardarAgendamiento(ss, {
      telefono: telefono, nombre: nombre, correo: correo,
      inicioISO: slotISO, eventoId: eventoId, meetLink: meetLink, meetCode: meetCode,
      provider: lead.provider || "", curso: lead.curso || ""
    });

    // Actualizar el estado del lead → paso con rol "agendado" (por rol, no por nombre).
    // Fallback a "CONFIRMO_MEET" solo si no hay un paso con ese rol en el flujo.
    const flujoAg = cargarFlujoBot();
    const estadoAgendado = estadoDeRol(flujoAg, "agendado") || "CONFIRMO_MEET";
    actualizarLead(ss, telefono, { estado: estadoAgendado, accion: "agendo_por_flow" });

    // Confirmar al cliente
    const fechaLegible = formatearSlotLegible(inicio);
    let confirmacion = textoAgenda(msgs, "MSG_AGENDA_CONFIRMADA");
    confirmacion = confirmacion.replace(/\{\{fecha\}\}/g, fechaLegible).replace(/\{fecha\}/g, fechaLegible);
    enviarTexto(telefono, confirmacion);
    logSheet("agenda", "✅ OK", "Agendado " + telefono + " → " + slotISO);

  } finally {
    lock.releaseLock();
  }
}

// Formatea un Date a texto legible para la confirmación (ej. "Martes 30 de Sep, 11:00 am")
function formatearSlotLegible(fecha) {
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const dow = parseInt(Utilities.formatDate(fecha, AGENDA_TZ, "u"), 10) % 7;
  const dd = parseInt(Utilities.formatDate(fecha, AGENDA_TZ, "dd"), 10);
  const mesIdx = parseInt(Utilities.formatDate(fecha, AGENDA_TZ, "MM"), 10) - 1;
  const hora = Utilities.formatDate(fecha, AGENDA_TZ, "h:mm a").replace("AM", "am").replace("PM", "pm");
  return dias[dow] + " " + dd + " de " + meses[mesIdx] + ", " + hora;
}

// ============================================================
// HOJA AGENDAMIENTOS — registro de reservas
// Columnas: TIMESTAMP | TELF | NOMBRE | CORREO | FECHA_HORA | ESTADO | EVENTO_ID | PROVIDER | CURSO | MEET_LINK
// (las columnas de recordatorios CONFIRMADA / RECORD_CONFIRM_ENVIADO / RECORD_DIA_ENVIADO
//  se crean on-demand desde Recordatorios.gs)
// ============================================================
function guardarAgendamiento(ss, d) {
  let hoja = ss.getSheetByName("AGENDAMIENTOS");
  if (!hoja) {
    hoja = ss.insertSheet("AGENDAMIENTOS");
    hoja.appendRow(["TIMESTAMP", "TELF", "NOMBRE", "CORREO", "FECHA_HORA", "ESTADO", "EVENTO_ID", "PROVIDER", "CURSO", "MEET_LINK"]);
  }
  // Asegurar columnas MEET_LINK y MEET_CODE aunque la hoja ya existiera sin ellas.
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => h.toString().trim().toUpperCase());
  let colMeet = headers.indexOf("MEET_LINK");
  if (colMeet === -1) { colMeet = headers.length; hoja.getRange(1, colMeet + 1).setValue("MEET_LINK"); headers.push("MEET_LINK"); }
  let colCode = headers.indexOf("MEET_CODE");
  if (colCode === -1) { colCode = headers.length; hoja.getRange(1, colCode + 1).setValue("MEET_CODE"); headers.push("MEET_CODE"); }

  const fila = [
    new Date(), d.telefono, d.nombre || "", d.correo || "",
    d.inicioISO, "AGENDADO", d.eventoId || "", d.provider || "", d.curso || ""
  ];
  // Rellenar hasta cubrir las columnas de Meet por si hay columnas intermedias nuevas.
  const maxCol = Math.max(colMeet, colCode);
  while (fila.length <= maxCol) fila.push("");
  fila[colMeet] = d.meetLink || "";
  fila[colCode] = d.meetCode || "";
  hoja.appendRow(fila);
}

// ============================================================
// Crea un evento con conferencia de Google Meet (Calendar API avanzada).
// Devuelve { eventoId, meetLink }. Si falla la creación con Meet, cae a
// CalendarApp sin Meet para no bloquear el agendamiento.
// ============================================================
function crearEventoConMeet(calendarId, d) {
  try {
    const evento = {
      summary: d.titulo,
      description: d.descripcion,
      start: { dateTime: d.inicio.toISOString(), timeZone: AGENDA_TZ },
      end:   { dateTime: d.fin.toISOString(),    timeZone: AGENDA_TZ },
      conferenceData: {
        createRequest: {
          requestId: "abc-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    };
    // Invitados: el cliente (si dio correo) y el asesor asignado.
    const attendees = [];
    if (d.correo)       attendees.push({ email: d.correo });
    if (d.correoAsesor) attendees.push({ email: d.correoAsesor });
    if (attendees.length) evento.attendees = attendees;

    const creado = Calendar.Events.insert(evento, calendarId, {
      conferenceDataVersion: 1,
      sendUpdates: attendees.length ? "all" : "none"
    });

    let meetLink = creado.hangoutLink || "";
    let meetCode = "";
    if (creado.conferenceData) {
      if (creado.conferenceData.conferenceId) meetCode = creado.conferenceData.conferenceId;
      if (!meetLink && creado.conferenceData.entryPoints) {
        const ep = creado.conferenceData.entryPoints.find(e => e.entryPointType === "video");
        if (ep) meetLink = ep.uri || "";
      }
    }
    // Si no vino el conferenceId, derivarlo del propio link (meet.google.com/xxx-yyyy-zzz).
    if (!meetCode && meetLink) {
      const m = meetLink.match(/meet\.google\.com\/([a-z0-9\-]+)/i);
      if (m) meetCode = m[1];
    }
    return { eventoId: creado.id || "", meetLink: meetLink, meetCode: meetCode };
  } catch (e) {
    logSheet("agenda", "⚠️ WARNING", "Calendar API Meet falló, uso CalendarApp sin Meet: " + e.message);
    try {
      const cal = CalendarApp.getCalendarById(calendarId);
      const opciones = { description: d.descripcion };
      const invitados = [d.correo, d.correoAsesor].filter(Boolean).join(",");
      if (invitados) { opciones.guests = invitados; opciones.sendInvites = true; }
      const ev = cal.createEvent(d.titulo, d.inicio, d.fin, opciones);
      return { eventoId: ev ? ev.getId() : "", meetLink: "", meetCode: "" };
    } catch (e2) {
      logSheet("agenda", "❌ ERROR", "No se pudo crear el evento: " + e2.message);
      return { eventoId: "", meetLink: "", meetCode: "" };
    }
  }
}

// ============================================================
// DIAGNÓSTICO — probar el cálculo de slots desde el editor
// ============================================================
function probarSlots() {
  const slots = calcularSlotsDisponibles();
  Logger.log("Slots disponibles (" + slots.length + "):");
  slots.forEach(s => Logger.log("  " + s.title + "  [" + s.id + "]"));
}

// ============================================================
// DIAGNÓSTICO — enviar el Flow MÍNIMO (sin datos dinámicos) para aislar
// si el error 131009 es por flow_id/WABA o por el contenido del payload.
// Editar TELEFONO_PRUEBA. Revisar Log + hoja LOGS.
// ============================================================
function probarFlowMinimo() {
  const TELEFONO_PRUEBA = "000000000000";
  const payload = {
    messaging_product: "whatsapp",
    to: TELEFONO_PRUEBA,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: "Prueba de Flow" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: "test_" + Date.now(),
          flow_id: FLOW_ID_AGENDA,
          flow_cta: "Abrir",
          flow_action: "navigate",
          flow_action_payload: { screen: "AGENDAR" }
        }
      }
    }
  };
  const res = enviarMensajeWA(payload);
  Logger.log("Resultado envío Flow mínimo: " + res);
}
