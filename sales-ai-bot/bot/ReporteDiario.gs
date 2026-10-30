// ============================================================
// REPORTE DIARIO POR CORREO (anti no-show)
// Trigger diario que envía un resumen operativo a los correos configurados.
// Contenido:
//   1) Sesiones de HOY (hora, cliente, curso, confirmada/sin confirmar, link Meet)
//   2) Confirmadas vs sin confirmar (de hoy)
//   3) A quién NO se le pudo recordar automático (fuera de ventana 24h) → contactar a mano
//   4) Agendamientos nuevos de AYER
//   5) Resumen de los últimos 7 días (agendados / asistieron / no-show / convertidos)
//
// Config editable desde el panel (página "Flow" → claves en hoja MENSAJES):
//   MSG_REPORTE_DESTINATARIOS  → correos separados por coma
//   MSG_REPORTE_ASUNTO         → asunto del correo (admite {fecha})
//   MSG_REPORTE_INTRO          → texto introductorio del correo
// ============================================================

const REPORTE_DEST_DEFAULT   = "contact@example.com, advisor1@example.com";
const REPORTE_ASUNTO_DEFAULT = "Reporte diario de asesorias - {fecha}";
const REPORTE_INTRO_DEFAULT  = "Resumen operativo de asesorías de Cloud Academy. Revisa sobre todo a quién hay que contactar a mano.";

function _cfgReporte(msgs, clave, def) {
  const v = msg(msgs, clave);
  return (!v || v === clave) ? def : v;
}

// ============================================================
// MOTOR — instalar como trigger diario (ver instalarReporteDiario)
// ============================================================
function enviarReporteDiario() {
  const ss = getDataSS();
  const msgs = cargarMensajes(ss);
  const hoja = ss.getSheetByName("AGENDAMIENTOS");

  const destRaw = _cfgReporte(msgs, "MSG_REPORTE_DESTINATARIOS", REPORTE_DEST_DEFAULT);
  const destinatarios = destRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (!destinatarios.length) { logSheet("reporte", "⚠️ WARNING", "Sin destinatarios"); return; }

  const ahora = new Date();
  const fechaHoyTxt = formatearFechaEspanol(ahora, AGENDA_TZ);
  const asunto = _cfgReporte(msgs, "MSG_REPORTE_ASUNTO", REPORTE_ASUNTO_DEFAULT).replace(/\{fecha\}/g, fechaHoyTxt);
  const intro  = _cfgReporte(msgs, "MSG_REPORTE_INTRO", REPORTE_INTRO_DEFAULT);

  const datos = _recopilarDatosReporte(hoja, ahora);
  const cuerpo = _construirHtmlReporte(datos, fechaHoyTxt, intro);
  // Envolver en un documento HTML con meta charset UTF-8: sin él, algunos clientes
  // de correo corrompen los emojis de 4 bytes (📊 📅 📣 →rombos ♦).
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
               '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
               '<body style="margin:0;padding:0;">' + cuerpo + '</body></html>';

  GmailApp.sendEmail(destinatarios.join(","), asunto, "", {
    htmlBody: html, name: "Cloud Academy", charset: "UTF-8"
  });
  logSheet("reporte", "✅ OK", "Reporte diario enviado a: " + destinatarios.join(", "));
}

// Recorre AGENDAMIENTOS y arma los datos de los 5 bloques.
function _recopilarDatosReporte(hoja, ahora) {
  const d = {
    hoy: [], confirmadasHoy: 0, sinConfirmarHoy: 0,
    sinRecordar: [], nuevosAyer: 0,
    sem: { agendados: 0, asistieron: 0, noShow: 0, convertidos: 0 }
  };
  if (!hoja) return d;
  const data = hoja.getDataRange().getValues();
  if (data.length < 2) return d;

  const H = data[0].map(h => h.toString().trim().toUpperCase());
  const c = (n) => H.indexOf(n);
  const cTel = c("TELF"), cNom = c("NOMBRE"), cFecha = c("FECHA_HORA"), cEstado = c("ESTADO"),
        cCurso = c("CURSO"), cProv = c("PROVIDER"), cMeet = c("MEET_LINK"), cConf = c("CONFIRMADA"),
        cNoVent = c("RECORD_NO_VENTANA"), cTs = c("TIMESTAMP");

  const hoyTxt = Utilities.formatDate(ahora, AGENDA_TZ, "yyyy-MM-dd");
  const ayer = new Date(ahora.getTime() - 86400000);
  const ayerTxt = Utilities.formatDate(ayer, AGENDA_TZ, "yyyy-MM-dd");
  const hace7 = new Date(ahora.getTime() - 7 * 86400000);

  for (let i = 1; i < data.length; i++) {
    const tel = (data[i][cTel] || "").toString().trim();
    if (!tel) continue;
    const fechaRaw = data[i][cFecha];
    const inicio = fechaRaw ? new Date(fechaRaw) : null;
    const estado = (cEstado >= 0 ? (data[i][cEstado] || "").toString().trim().toUpperCase() : "");
    const confirmada = (cConf >= 0 && (data[i][cConf] || "").toString().trim().toUpperCase() === "SI");
    const nombre = (cNom >= 0 ? (data[i][cNom] || "").toString().trim() : "") || tel;
    const curso = (cCurso >= 0 ? (data[i][cCurso] || "").toString().trim() : "");
    const prov  = (cProv >= 0 ? (data[i][cProv] || "").toString().trim() : "");
    const meet  = (cMeet >= 0 ? (data[i][cMeet] || "").toString().trim() : "");

    // Bloque 1 y 2: sesiones de HOY
    if (inicio && !isNaN(inicio.getTime()) && Utilities.formatDate(inicio, AGENDA_TZ, "yyyy-MM-dd") === hoyTxt) {
      if (["ASISTIO","NO_ASISTIO","CONVERTIDO","CANCELADA"].indexOf(estado) === -1) {
        d.hoy.push({
          hora: Utilities.formatDate(inicio, AGENDA_TZ, "hh:mm a"),
          nombre: nombre, tel: tel, curso: (prov ? prov + " " : "") + curso,
          confirmada: confirmada, meet: meet
        });
        if (confirmada) d.confirmadasHoy++; else d.sinConfirmarHoy++;
      }
    }

    // Bloque 3: no se pudo recordar automático (fuera de ventana) y la cita aún no pasó.
    if (cNoVent >= 0 && (data[i][cNoVent] || "").toString().trim()) {
      if (inicio && !isNaN(inicio.getTime()) && inicio.getTime() >= ahora.getTime() &&
          ["ASISTIO","NO_ASISTIO","CONVERTIDO","CANCELADA"].indexOf(estado) === -1) {
        d.sinRecordar.push({
          cuando: Utilities.formatDate(inicio, AGENDA_TZ, "dd/MM hh:mm a"),
          nombre: nombre, tel: tel, motivo: (data[i][cNoVent] || "").toString().trim()
        });
      }
    }

    // Bloque 4: agendamientos nuevos de AYER (por TIMESTAMP de registro)
    if (cTs >= 0 && data[i][cTs]) {
      const ts = new Date(data[i][cTs]);
      if (!isNaN(ts.getTime()) && Utilities.formatDate(ts, AGENDA_TZ, "yyyy-MM-dd") === ayerTxt) d.nuevosAyer++;
    }

    // Bloque 5: resumen últimos 7 días (por fecha de la cita)
    if (inicio && !isNaN(inicio.getTime()) && inicio.getTime() >= hace7.getTime() && inicio.getTime() <= ahora.getTime()) {
      d.sem.agendados++;
      if (estado === "ASISTIO") d.sem.asistieron++;
      else if (estado === "NO_ASISTIO") d.sem.noShow++;
      else if (estado === "CONVERTIDO") d.sem.convertidos++;
    }
  }

  d.hoy.sort((a, b) => a.hora.localeCompare(b.hora));
  return d;
}

// Construye el cuerpo HTML del correo.
function _construirHtmlReporte(d, fechaHoyTxt, intro) {
  // Escapa HTML y convierte cualquier emoji de 4 bytes (plano astral) a entidad
  // numérica, para que GmailApp no lo corrompa en rombos (afecta a datos como
  // nombres de curso/provider que traen emojis guardados).
  const esc = (s) => (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, (ch) => "&#" + ch.codePointAt(0) + ";");
  const C = { tinta: "#0d1b3e", gris: "#6b7280", verde: "#16a34a", ambar: "#b45309", rojo: "#dc2626", borde: "#e5e7eb" };

  let h = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">';
  h += '<div style="background:' + C.tinta + ';color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">' +
       '<div style="font-size:18px;font-weight:bold;">&#128202; Reporte diario de asesorías</div>' +
       '<div style="font-size:13px;opacity:.85;margin-top:4px;">' + esc(fechaHoyTxt) + '</div></div>';
  h += '<div style="border:1px solid ' + C.borde + ';border-top:none;border-radius:0 0 10px 10px;padding:22px 24px;">';
  if (intro) h += '<p style="font-size:13px;color:' + C.gris + ';margin:0 0 18px;">' + esc(intro) + '</p>';

  const sec = (titulo) => '<div style="font-size:15px;font-weight:bold;color:' + C.tinta + ';margin:22px 0 10px;border-bottom:2px solid ' + C.borde + ';padding-bottom:6px;">' + titulo + '</div>';

  // Bloque 1 + 2: sesiones de hoy
  h += sec('&#128197; Sesiones de hoy (' + d.hoy.length + ')');
  h += '<p style="font-size:13px;margin:0 0 10px;"><span style="color:' + C.verde + ';font-weight:bold;">✅ ' + d.confirmadasHoy + ' confirmadas</span> &nbsp;·&nbsp; <span style="color:' + C.ambar + ';font-weight:bold;">⏳ ' + d.sinConfirmarHoy + ' sin confirmar</span></p>';
  if (!d.hoy.length) {
    h += '<p style="font-size:13px;color:' + C.gris + ';">Hoy no hay sesiones agendadas.</p>';
  } else {
    h += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    h += '<tr style="background:#f9fafb;"><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Hora</th><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Cliente</th><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Curso</th><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Estado</th></tr>';
    d.hoy.forEach(s => {
      const estadoTxt = s.confirmada
        ? '<span style="color:' + C.verde + ';font-weight:bold;">✅ Confirmada</span>'
        : '<span style="color:' + C.ambar + ';font-weight:bold;">⏳ Sin confirmar</span>';
      const meetTxt = s.meet ? '<br><a href="' + esc(s.meet) + '" style="color:#2563eb;font-size:11px;">&#128279; Unirse a la Meet</a>' : '';
      h += '<tr><td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + esc(s.hora) + '</td>' +
           '<td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + esc(s.nombre) + '<br><span style="color:' + C.gris + ';font-size:11px;">' + esc(s.tel) + '</span></td>' +
           '<td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + esc(s.curso || '-') + '</td>' +
           '<td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + estadoTxt + meetTxt + '</td></tr>';
    });
    h += '</table>';
  }

  // Bloque 3: a contactar a mano
  h += sec('⚠️ Contactar a mano (' + d.sinRecordar.length + ')');
  h += '<p style="font-size:12px;color:' + C.gris + ';margin:0 0 10px;">Clientes a los que el bot NO pudo recordar automáticamente (fuera de la ventana de 24h de WhatsApp). Conviene contactarlos manualmente.</p>';
  if (!d.sinRecordar.length) {
    h += '<p style="font-size:13px;color:' + C.verde + ';">Nada pendiente. &#127881;</p>';
  } else {
    h += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    h += '<tr style="background:#fff7ed;"><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Cita</th><th style="text-align:left;padding:8px;border-bottom:1px solid ' + C.borde + ';">Cliente</th></tr>';
    d.sinRecordar.forEach(s => {
      h += '<tr><td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + esc(s.cuando) + '</td>' +
           '<td style="padding:8px;border-bottom:1px solid ' + C.borde + ';">' + esc(s.nombre) + ' <span style="color:' + C.gris + ';font-size:11px;">(' + esc(s.tel) + ')</span></td></tr>';
    });
    h += '</table>';
  }

  // Bloque 4
  h += sec('&#127381; Agendamientos nuevos de ayer');
  h += '<p style="font-size:22px;font-weight:bold;color:' + C.tinta + ';margin:0;">' + d.nuevosAyer + '</p>';

  // Bloque 5: resumen 7 días
  h += sec('&#128200; Últimos 7 días');
  const s = d.sem;
  const tasa = s.agendados ? Math.round((s.asistieron / s.agendados) * 100) : 0;
  h += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  h += '<tr>' +
       '<td style="padding:10px;text-align:center;background:#f9fafb;border:1px solid ' + C.borde + ';"><div style="font-size:20px;font-weight:bold;">' + s.agendados + '</div><div style="font-size:11px;color:' + C.gris + ';">Agendados</div></td>' +
       '<td style="padding:10px;text-align:center;background:#f9fafb;border:1px solid ' + C.borde + ';"><div style="font-size:20px;font-weight:bold;color:' + C.verde + ';">' + s.asistieron + '</div><div style="font-size:11px;color:' + C.gris + ';">Asistieron</div></td>' +
       '<td style="padding:10px;text-align:center;background:#f9fafb;border:1px solid ' + C.borde + ';"><div style="font-size:20px;font-weight:bold;color:' + C.rojo + ';">' + s.noShow + '</div><div style="font-size:11px;color:' + C.gris + ';">No-show</div></td>' +
       '<td style="padding:10px;text-align:center;background:#f9fafb;border:1px solid ' + C.borde + ';"><div style="font-size:20px;font-weight:bold;color:' + C.verde + ';">' + s.convertidos + '</div><div style="font-size:11px;color:' + C.gris + ';">Convertidos</div></td>' +
       '</tr></table>';
  h += '<p style="font-size:12px;color:' + C.gris + ';margin:8px 0 0;">Tasa de asistencia: <b>' + tasa + '%</b></p>';

  h += '</div>';
  h += '<p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0;">Enviado automáticamente por el bot de Cloud Academy.</p>';
  h += '</div>';
  return h;
}

// ============================================================
// Instalar el trigger diario (07:00–08:00). Ejecutar UNA vez desde el editor.
// ============================================================
function instalarReporteDiario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "enviarReporteDiario") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarReporteDiario").timeBased().atHour(7).everyDays(1).create();
  Logger.log("✅ Reporte diario: trigger instalado (cada día ~07:00). Motor: enviarReporteDiario.");
}

// Prueba manual: envía el reporte ahora mismo a los destinatarios configurados.
function probarReporteDiario() {
  enviarReporteDiario();
  Logger.log("Reporte de prueba enviado (revisa las bandejas configuradas).");
}
