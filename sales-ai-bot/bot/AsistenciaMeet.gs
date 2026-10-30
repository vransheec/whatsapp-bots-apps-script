// ============================================================
// MARCADO AUTOMÁTICO DE ASISTENCIA (Google Meet + Reports API)
// Para cada cita que ya terminó y aún no tiene resultado, consulta los audit
// logs de Meet (Admin SDK Reports API) y marca en AGENDAMIENTOS:
//   ASISTIO     → hubo al menos un participante "invitado" (alguien además del
//                 organizador/asesor) en la videollamada de ese código de Meet.
//   NO_ASISTIO  → la reunión no registró participantes externos.
//
// REQUISITOS (cuenta Workspace @example.com, se configuran una sola vez):
//   - Servicio avanzado "AdminReports" (Admin SDK Reports API) habilitado en el editor.
//   - La cuenta que ejecuta el script debe tener privilegio para leer los
//     Reports de Meet (rol de admin con acceso a informes, o super admin).
//
// NOTA honesta: Meet identifica a los participantes por su cuenta Google o nombre.
// Si el cliente entra como invitado anónimo, igual cuenta como participante externo.
// El asesor y el organizador (contacto@) se excluyen para no contar su sola presencia.
// La marca puede corregirse siempre a mano en el kanban.
// ============================================================

// Correos que NO cuentan como "asistencia del cliente" (organizador + asesores).
function _correosInternos() {
  const internos = { "contact@example.com": true };
  try {
    const ss = getDataSS();
    const asesores = cargarAsesoresBot(ss);
    asesores.forEach(a => { const c = (a.CORREO_ASESOR || "").trim().toLowerCase(); if (c) internos[c] = true; });
  } catch (e) {}
  return internos;
}

// ============================================================
// MOTOR — instalar como trigger horario (ver instalarAsistenciaMeet)
// ============================================================
function procesarAsistenciaMeet() {
  const ss = getDataSS();
  const hoja = ss.getSheetByName("AGENDAMIENTOS");
  if (!hoja) { logSheet("asistencia", "ℹ️ INFO", "No existe AGENDAMIENTOS"); return; }

  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return;
  const H = data[0].map(h => h.toString().trim().toUpperCase());
  const cTel = H.indexOf("TELF");
  const cFecha = H.indexOf("FECHA_HORA");
  const cEstado = H.indexOf("ESTADO");
  const cCode = H.indexOf("MEET_CODE");
  if (cTel === -1 || cFecha === -1 || cEstado === -1) { logSheet("asistencia", "⚠️ WARNING", "Faltan columnas base"); return; }
  if (cCode === -1) { logSheet("asistencia", "ℹ️ INFO", "Sin columna MEET_CODE (citas antiguas)"); return; }

  const internos = _correosInternos();
  const cfgAg = cargarConfigAgenda();
  const duracionMs = (cfgAg.duracion || 20) * 60000;
  const ahora = new Date();
  let marcados = 0;

  for (let i = 1; i < data.length; i++) {
    const tel = (data[i][cTel] || "").toString().trim();
    const code = (data[i][cCode] || "").toString().trim();
    const fechaRaw = data[i][cFecha];
    const estado = (data[i][cEstado] || "").toString().trim().toUpperCase();
    if (!tel || !fechaRaw) continue;
    // Solo citas cuyo resultado aún no se definió manual ni automáticamente.
    if (["ASISTIO", "NO_ASISTIO", "CONVERTIDO"].indexOf(estado) !== -1) continue;
    if (!code) continue; // sin código de Meet no se puede verificar

    const inicio = new Date(fechaRaw);
    if (isNaN(inicio.getTime())) continue;
    const fin = new Date(inicio.getTime() + duracionMs);
    // Solo cuando la reunión ya terminó (con 10 min de margen para que el log exista).
    if (ahora.getTime() < fin.getTime() + 10 * 60000) continue;

    try {
      const asistio = _meetTuvoParticipanteExterno(code, inicio, fin, internos);
      hoja.getRange(i + 1, cEstado + 1).setValue(asistio ? "ASISTIO" : "NO_ASISTIO");
      marcados++;
      logSheet("asistencia", "✅ OK", tel + " (" + code + ") → " + (asistio ? "ASISTIO" : "NO_ASISTIO"));
    } catch (e) {
      logSheet("asistencia", "❌ ERROR", tel + " (" + code + "): " + e.message);
    }
  }
  logSheet("asistencia", "✅ OK", "Citas marcadas automáticamente: " + marcados);
}

// Consulta los audit logs de Meet para un código de conferencia y determina si
// hubo al menos un participante que no sea interno (organizador/asesor).
function _meetTuvoParticipanteExterno(meetCode, inicio, fin, internos) {
  // Ventana ampliada para cubrir early-join / overrun.
  const startTime = new Date(inicio.getTime() - 15 * 60000).toISOString();
  const endTime   = new Date(fin.getTime()    + 60 * 60000).toISOString();

  // Normalizar el código (a veces con guiones, a veces sin).
  const codePlano = meetCode.replace(/-/g, "").toLowerCase();

  let pageToken = null;
  let huboExterno = false;

  do {
    const resp = AdminReports.Activities.list("all", "meet", {
      startTime: startTime,
      endTime: endTime,
      maxResults: 1000,
      pageToken: pageToken || undefined
    });

    const items = (resp && resp.items) || [];
    for (const item of items) {
      const events = item.events || [];
      for (const ev of events) {
        const params = {};
        (ev.parameters || []).forEach(p => {
          params[p.name] = (p.value !== undefined) ? p.value :
                           (p.intValue !== undefined ? p.intValue :
                           (p.boolValue !== undefined ? p.boolValue : ""));
        });
        // Filtrar por el código de la reunión (meeting_code / conference_id).
        const mc = ((params.meeting_code || params.conference_id || "") + "").replace(/-/g, "").toLowerCase();
        if (mc && mc !== codePlano) continue;

        // Identidad del participante.
        const email = ((params.identifier || item.actor?.email || "") + "").trim().toLowerCase();
        const esAnonimo = (params.is_external === true) || (!email);
        const esInterno = email && internos[email];

        // Un invitado externo (cliente): email no interno, o participante anónimo.
        if ((!esInterno && email) || esAnonimo) {
          // Confirmar que es un evento de participación real (join/call).
          const nombreEv = (ev.name || "").toLowerCase();
          if (nombreEv.indexOf("call") !== -1 || nombreEv.indexOf("participant") !== -1 || params.duration_seconds) {
            huboExterno = true;
            break;
          }
          // Si no hay nombre de evento claro pero sí identidad externa, también cuenta.
          huboExterno = true;
          break;
        }
      }
      if (huboExterno) break;
    }
    pageToken = resp && resp.nextPageToken;
  } while (pageToken && !huboExterno);

  return huboExterno;
}

// ============================================================
// Instalar el trigger horario del marcado de asistencia. Ejecutar UNA vez.
// ============================================================
function instalarAsistenciaMeet() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "procesarAsistenciaMeet") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("procesarAsistenciaMeet").timeBased().everyHours(1).create();
  Logger.log("✅ Asistencia Meet: trigger horario instalado. Motor: procesarAsistenciaMeet.");
}

// Prueba manual: corre el marcado ahora y muestra el resultado en el log.
function probarAsistenciaMeet() {
  procesarAsistenciaMeet();
  Logger.log("Marcado de asistencia ejecutado. Revisa la hoja AGENDAMIENTOS y los LOGS.");
}
