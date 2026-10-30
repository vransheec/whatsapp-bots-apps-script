// ============================================================
// Cloud Academy — Recordatorio de asesoría por correo
// Script standalone — trigger diario entre 07:00 y 09:00
// Busca eventos del día en el calendario de Advisor 1,
// extrae nombre/correo/teléfono y envía correo HTML al alumno
// ============================================================

const CALENDAR_EMAIL    = "advisor1@example.com";
const LINK_REAGENDAR    = "https://calendly.com/your-handle/asesoria";
const LOGO_URL = "https://drive.google.com/uc?export=view&id=YOUR_DRIVE_ID";
const CORREO_EXCLUIR    = "advisor1@example.com";

// Mapa código de país → zona horaria
const TIMEZONE_MAP = {
  "1":   "America/New_York",   // USA/Canadá — fallback
  "52":  "America/Mexico_City",
  "53":  "America/Havana",
  "54":  "America/Argentina/Buenos_Aires",
  "55":  "America/Sao_Paulo",
  "56":  "America/Santiago",
  "57":  "America/Bogota",
  "58":  "America/Caracas",
  "51":  "America/Lima",
  "502": "America/Guatemala",
  "503": "America/El_Salvador",
  "504": "America/Tegucigalpa",
  "505": "America/Managua",
  "506": "America/Costa_Rica",
  "507": "America/Panama",
  "509": "America/Port-au-Prince",
  "591": "America/La_Paz",
  "592": "America/Guyana",
  "593": "America/Guayaquil",
  "594": "America/Cayenne",
  "595": "America/Asuncion",
  "596": "America/Martinique",
  "597": "America/Paramaribo",
  "598": "America/Montevideo",
  "34":  "Europe/Madrid"       // España
};

// Nombres de países para el correo
const PAIS_MAP = {
  "1":   "Estados Unidos",
  "52":  "México",
  "53":  "Cuba",
  "54":  "Argentina",
  "55":  "Brasil",
  "56":  "Chile",
  "57":  "Colombia",
  "58":  "Venezuela",
  "51":  "Perú",
  "502": "Guatemala",
  "503": "El Salvador",
  "504": "Honduras",
  "505": "Nicaragua",
  "506": "Costa Rica",
  "507": "Panamá",
  "509": "Haití",
  "591": "Bolivia",
  "592": "Guyana",
  "593": "Ecuador",
  "594": "Guayana Francesa",
  "595": "Paraguay",
  "596": "Martinica",
  "597": "Surinam",
  "598": "Uruguay",
  "34":  "España"
};

// ============================================================
// FUNCIÓN PRINCIPAL — instalar como trigger diario 07:00–09:00
// ============================================================
function enviarRecordatorios() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_EMAIL);
  if (!calendar) {
    Logger.log("❌ No se pudo acceder al calendario: " + CALENDAR_EMAIL);
    return;
  }

  const hoy    = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
  const fin    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  const eventos = calendar.getEvents(inicio, fin);
  Logger.log("📅 Eventos hoy: " + eventos.length);

  let enviados = 0;

  for (const evento of eventos) {
    try {
      const titulo      = evento.getTitle();
      const descripcion = evento.getDescription() || "";
      const meetLink    = extraerMeetLink(descripcion);
      const inicioEvt   = evento.getStartTime();

      // Extraer nombre del alumno del título
      // Formato: "Joen Rojas y Advisor 1 Cloud Academy"
      const nombreAlumno = extraerNombreAlumno(titulo);
      if (!nombreAlumno) {
        Logger.log("⚠️ No se pudo extraer nombre de: " + titulo);
        continue;
      }

      // Extraer teléfono de la descripción
      // Formato: "Número de WhatsApp: +51 963 190 067"
      const telefono   = extraerTelefono(descripcion);
      const codigoPais = telefono ? extraerCodigoPais(telefono) : null;
      const timezone   = codigoPais ? (TIMEZONE_MAP[codigoPais] || "America/Lima") : "America/Lima";
      const pais       = codigoPais ? (PAIS_MAP[codigoPais]     || "")             : "";

      // Formatear hora local del alumno
      const horaLocal = Utilities.formatDate(inicioEvt, timezone, "hh:mm a");
      const fechaLocal = formatearFechaEspanol(inicioEvt, timezone);

      // Obtener correo del alumno (invitado que no es Advisor 1)
      const invitados   = evento.getGuestList();
      const correoAlumno = invitados
        .map(g => g.getEmail())
        .find(e => e.toLowerCase() !== CORREO_EXCLUIR.toLowerCase());

      if (!correoAlumno) {
        Logger.log("⚠️ Sin correo de alumno en evento: " + titulo);
        continue;
      }

      // Construir y enviar correo
      const asunto = "Recordatorio: Tu asesoria con Cloud Academy es hoy";
      const cuerpo = construirCorreoHTML(
        nombreAlumno, fechaLocal, horaLocal, pais, meetLink, LINK_REAGENDAR
      );

      GmailApp.sendEmail(correoAlumno, asunto, "", {
        htmlBody: cuerpo,
        name:     "Cloud Academy",
        charset:  "UTF-8"
      });

      Logger.log("✅ Correo enviado a: " + correoAlumno + " | " + nombreAlumno + " | " + horaLocal + " (" + pais + ")");
      enviados++;
      Utilities.sleep(500);

    } catch (e) {
      Logger.log("❌ Error procesando evento '" + evento.getTitle() + "': " + e.message);
    }
  }

  Logger.log("✅ Total recordatorios enviados: " + enviados);
}

// ============================================================
// Formatea una fecha en español: "sábado 30 de mayo de 2026"
// ============================================================
function formatearFechaEspanol(fecha, timezone) {
  const DIAS   = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const MESES  = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  // Convertir a la zona horaria correcta usando formatDate para extraer partes
  const dia    = parseInt(Utilities.formatDate(fecha, timezone, "d"));
  const mes    = parseInt(Utilities.formatDate(fecha, timezone, "M")) - 1;
  const anio   = Utilities.formatDate(fecha, timezone, "yyyy");
  const diaSem = parseInt(Utilities.formatDate(fecha, timezone, "u")) % 7; // 1=lun..7=dom → 0=dom
  return DIAS[diaSem] + " " + dia + " de " + MESES[mes] + " de " + anio;
}

// ============================================================
// Extrae el Meet link de la descripción del evento
// Busca URLs de meet.google.com o zoom o cualquier https
// ============================================================
function extraerMeetLink(descripcion) {
  if (!descripcion) return "";
  // Primero buscar meet.google.com
  const meetMatch = descripcion.match(/https:\/\/meet\.google\.com\/[a-z0-9\-]+/i);
  if (meetMatch) return meetMatch[0];
  // Luego zoom
  const zoomMatch = descripcion.match(/https:\/\/[a-z0-9]+\.zoom\.us\/[^\s<"]+/i);
  if (zoomMatch) return zoomMatch[0];
  // Fallback: cualquier https
  const urlMatch = descripcion.match(/https:\/\/[^\s<"]+/i);
  if (urlMatch) return urlMatch[0];
  return "";
}

// ============================================================
// Extrae el nombre del alumno del título del evento
// "Joen Rojas y Advisor 1 Cloud Academy" → "Joen Rojas"
// ============================================================
function extraerNombreAlumno(titulo) {
  if (!titulo) return null;
  // Buscar " y Advisor 1" (case-insensitive)
  const match = titulo.match(/^(.+?)\s+y\s+Advisor 1/i);
  if (match) return match[1].trim();
  // Fallback: todo antes del primer " y "
  const idx = titulo.toLowerCase().indexOf(" y ");
  if (idx > 0) return titulo.substring(0, idx).trim();
  return titulo.trim();
}

// ============================================================
// Extrae el teléfono de la descripción
// "Número de WhatsApp: +51 963 190 067" → "+51963190067"
// ============================================================
function extraerTelefono(descripcion) {
  if (!descripcion) return null;
  const match = descripcion.match(/N[uú]mero de WhatsApp[:\s]+([+\d\s\-().]+)/i);
  if (!match) return null;
  return match[1].replace(/[\s\-().]/g, "").trim();
}

// ============================================================
// Extrae el código de país del teléfono
// "+51963190067" → "51"
// Prueba primero códigos de 3 dígitos, luego 2, luego 1
// ============================================================
function extraerCodigoPais(telefono) {
  const tel = telefono.replace(/^\+/, "");
  // Probar 3 dígitos primero (502, 503, etc.)
  const c3 = tel.substring(0, 3);
  if (TIMEZONE_MAP[c3]) return c3;
  // Luego 2 dígitos
  const c2 = tel.substring(0, 2);
  if (TIMEZONE_MAP[c2]) return c2;
  // Luego 1 dígito
  const c1 = tel.substring(0, 1);
  if (TIMEZONE_MAP[c1]) return c1;
  return null;
}

// ============================================================
// Construye el HTML del correo
// ============================================================
function construirCorreoHTML(nombre, fecha, hora, pais, meetLink, linkReagendar) {
  const horaTexto = pais ? hora + " (hora de " + pais + ")" : hora;
  const meetBtn   = meetLink
    ? '<a href="' + meetLink + '" style="background:#0d1b3e;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin:8px 4px;">&#128249; Unirme a la Meet</a>'
    : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- CABECERA CON LOGO -->
        <tr>
          <td style="background:#ffffff;padding:28px 40px 0;text-align:center;">
            <img src="${LOGO_URL}" alt="Cloud Academy" style="max-height:70px;max-width:220px;display:block;margin:0 auto;">
          </td>
        </tr>
        <!-- FRANJA AZUL MARINO -->
        <tr>
          <td style="background:#0d1b3e;padding:10px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8aaee0;letter-spacing:1.5px;text-transform:uppercase;">Certificaciones Cloud</p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:40px 40px 20px;">
            <p style="font-size:16px;color:#333;margin:0 0 16px;">Hola <strong>${nombre}</strong>,</p>
            <p style="font-size:15px;color:#333;margin:0 0 16px;">
              Te recordamos que hoy tienes una <strong>asesoria gratuita</strong> con el equipo de <strong>Cloud Academy</strong>.
            </p>

            <!-- DETALLES DEL EVENTO -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:8px;padding:20px;margin:20px 0;">
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:14px;color:#555;"><strong>Fecha:</strong></span>
                  <span style="font-size:14px;color:#333;"> ${fecha}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:14px;color:#555;"><strong>Hora:</strong></span>
                  <span style="font-size:14px;color:#333;"> ${horaTexto}</span>
                </td>
              </tr>
            </table>

            <p style="font-size:15px;color:#333;margin:0 0 24px;">
              Preparate para resolver todas tus dudas sobre certificaciones cloud y dar el siguiente paso en tu carrera.
            </p>

            <!-- BOTONES -->
            <div style="text-align:center;margin:24px 0;">
              ${meetBtn}
              <a href="${linkReagendar}" style="background:#f0f0f0;color:#333;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin:8px 4px;">Reagendar cita</a>
            </div>

            <p style="font-size:13px;color:#888;margin:24px 0 0;">
              Si tienes alguna duda antes de la sesion, puedes responder este correo o escribirnos por WhatsApp.
            </p>
          </td>
        </tr>

        <!-- PIE -->
        <tr>
          <td style="background:#0d1b3e;padding:20px 40px;text-align:center;">
            <p style="font-size:12px;color:#8aaee0;margin:0;">&copy; ${new Date().getFullYear()} Cloud Academy &middot; Todos los derechos reservados</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ============================================================
// SETUP — ejecutar UNA SOLA VEZ para instalar el trigger diario
// Se ejecuta entre las 07:00 y 09:00 cada día
// ============================================================
function instalarTriggerRecordatorio() {
  // Eliminar triggers previos
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "enviarRecordatorios") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("enviarRecordatorios")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log("✅ Trigger diario instalado — se ejecutará entre 07:00 y 09:00");
}

// ============================================================
// PRUEBA — ejecutar manualmente para verificar sin enviar correos
// ============================================================
function probarRecordatorios() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_EMAIL);
  if (!calendar) { Logger.log("❌ Calendario no encontrado"); return; }

  const hoy    = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
  const fin    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
  const eventos = calendar.getEvents(inicio, fin);

  Logger.log("📅 Eventos hoy: " + eventos.length);

  for (const evento of eventos) {
    const titulo      = evento.getTitle();
    const descripcion = evento.getDescription() || "";
    const meetLink    = extraerMeetLink(descripcion);
    const inicioEvt   = evento.getStartTime();

    const nombreAlumno = extraerNombreAlumno(titulo);
    const telefono     = extraerTelefono(descripcion);
    const codigoPais   = telefono ? extraerCodigoPais(telefono) : null;
    const timezone     = codigoPais ? (TIMEZONE_MAP[codigoPais] || "America/Lima") : "America/Lima";
    const pais         = codigoPais ? (PAIS_MAP[codigoPais] || "desconocido") : "desconocido";
    const horaLocal    = Utilities.formatDate(inicioEvt, timezone, "hh:mm a");
    const fechaLocal   = formatearFechaEspanol(inicioEvt, timezone);

    const invitados    = evento.getGuestList();
    const correoAlumno = invitados.map(g => g.getEmail()).find(e => e.toLowerCase() !== CORREO_EXCLUIR.toLowerCase()) || "(sin correo)";

    Logger.log("─────────────────────────────");
    Logger.log("Título:   " + titulo);
    Logger.log("Alumno:   " + nombreAlumno);
    Logger.log("Correo:   " + correoAlumno);
    Logger.log("Teléfono: " + (telefono || "(no encontrado)"));
    Logger.log("País:     " + pais + " (código: " + codigoPais + ")");
    Logger.log("Hora:     " + horaLocal + " — " + fechaLocal);
    Logger.log("Meet:     " + meetLink);
  }
}

// ============================================================
// VERIFICACIÓN DE AGENDAMIENTO EN GOOGLE CALENDAR
// Busca en los eventos de los próximos 4 días del calendar de
// contact@example.com si el número del cliente aparece en la descripción.
// ============================================================

/**
 * Verifica si un número de teléfono tiene un evento agendado
 * en los próximos 4 días.
 * @param {string} telefono — número del cliente (ej: "000000000000")
 * @returns {Object} { encontrado: boolean, evento: { titulo, fecha } | null }
 */
function verificarAgendamiento(telefono) {
  try {
    const ahora = new Date();
    const en4Dias = new Date(ahora.getTime() + 4 * 24 * 60 * 60 * 1000);

    // Obtener TODOS los calendarios accesibles (propios + compartidos)
    const calendarios = CalendarApp.getAllCalendars();

    // Normalizar teléfono para búsqueda (solo dígitos)
    const telLimpio = telefono.replace(/\D/g, "");
    // Crear variantes para matchear formatos como "+51 970 369 379"
    const variantes = [
      telLimpio,
      "+" + telLimpio,
      telLimpio.substring(0, 2) + " " + telLimpio.substring(2, 5) + " " + telLimpio.substring(5, 8) + " " + telLimpio.substring(8),
      "+" + telLimpio.substring(0, 2) + " " + telLimpio.substring(2, 5) + " " + telLimpio.substring(5, 8) + " " + telLimpio.substring(8)
    ];

    for (const calendar of calendarios) {
      const eventos = calendar.getEvents(ahora, en4Dias);
      for (const evento of eventos) {
        const descripcion = evento.getDescription() || "";
        for (const variante of variantes) {
          if (descripcion.includes(variante)) {
            const fechaEvento = evento.getStartTime();
            const titulo = evento.getTitle();
            console.log("✅ Agendamiento encontrado en calendar: " + calendar.getName() + " | " + titulo + " | " + fechaEvento);
            return {
              encontrado: true,
              evento: {
                titulo: titulo,
                fecha: Utilities.formatDate(fechaEvento, "America/Lima", "dd/MM/yyyy"),
                hora: Utilities.formatDate(fechaEvento, "America/Lima", "HH:mm")
              }
            };
          }
        }
      }
    }

    console.log("❌ No se encontró agendamiento para: " + telefono + " | Calendarios revisados: " + calendarios.length);
    return { encontrado: false, evento: null };

  } catch (e) {
    console.log("❌ Error verificando agendamiento: " + e.message);
    return { encontrado: false, evento: null };
  }
}
