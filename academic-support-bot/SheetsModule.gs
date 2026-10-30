// ============================================
// Cloud Academy Bot v2 - SheetsModule.gs
// Lectura del Sheet: CONFIGURACION, MENU, LOG
// ============================================

let _configCache = null;
let _menuCache = null;
let _configCacheTimestamp = 0;
let _menuCacheTimestamp = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos

// ============================================
// CONFIGURACIÓN
// Combina Script Properties (sensible) + Hoja CONFIGURACION (mensajes)
// ============================================

// Claves que se leen SOLO desde Script Properties (nunca del Sheet)
const CLAVES_PROPERTIES = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'CRM_SHEET_ID',
  'EMAIL_ACADEMICO',
  'DEBUG_NUMEROS'
];

function getConfig() {
  const ahora = Date.now();
  if (_configCache && (ahora - _configCacheTimestamp) < CACHE_DURATION_MS) {
    return _configCache;
  }
  try {
    // 1. Leer mensajes/textos desde la hoja CONFIGURACION
    const config = {};
    const botSheetId = getBotSheetId();
    if (botSheetId) {
      const ss = SpreadsheetApp.openById(botSheetId);
      const sheet = ss.getSheetByName('CONFIGURACION');
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const clave = String(data[i][0] || '').trim();
          const valor = String(data[i][1] || '').trim();
          // Solo cargar si NO es una clave sensible (esas van por Properties)
          if (clave && CLAVES_PROPERTIES.indexOf(clave) === -1) {
            config[clave] = valor;
          }
        }
      }
    }

    // 2. Sobrescribir/agregar claves sensibles desde Script Properties
    const props = PropertiesService.getScriptProperties();
    CLAVES_PROPERTIES.forEach(function(clave) {
      const valor = props.getProperty(clave);
      if (valor) config[clave] = valor;
    });

    _configCache = config;
    _configCacheTimestamp = ahora;
    return config;
  } catch (error) {
    Logger.log('❌ Error config: ' + error.toString());
    return _configCache || {};
  }
}

// ============================================
// MENÚ (árbol de nodos)
// ============================================
function getMenu() {
  const ahora = Date.now();
  if (_menuCache && (ahora - _menuCacheTimestamp) < CACHE_DURATION_MS) {
    return _menuCache;
  }
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName('MENU');
    if (!sheet) { Logger.log('❌ Hoja MENU no encontrada'); return []; }
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data[0];
    const nodos = [];
    for (let i = 1; i < data.length; i++) {
      const activo = String(data[i][headers.indexOf('ACTIVO')] || '').trim().toUpperCase();
      if (activo !== 'SI') continue;
      const nodo = {};
      headers.forEach(function(h, idx) {
        nodo[h] = String(data[i][idx] || '').trim();
      });
      nodos.push(nodo);
    }
    _menuCache = nodos;
    _menuCacheTimestamp = ahora;
    return nodos;
  } catch (error) {
    Logger.log('❌ Error menu: ' + error.toString());
    return _menuCache || [];
  }
}

// ============================================
// OBTENER NODO POR ID
// ============================================
function obtenerNodoPorId(id) {
  if (!id) return null;
  const menu = getMenu();
  return menu.find(function(n) { return n.ID === id; }) || null;
}

// ============================================
// REEMPLAZAR VARIABLES
// ============================================
function reemplazarVariables(texto, userData, config) {
  if (!texto) return texto;
  let r = texto;

  // Variables del usuario
  if (userData) {
    r = r.replace(/\{nombre\}/gi, userData.nombre || '');
    r = r.replace(/\{nombre_alumno\}/gi, userData.nombre || '');
    r = r.replace(/\{primer_nombre\}/gi, (userData.nombre || '').split(' ')[0]);
    r = r.replace(/\{email\}/gi, userData.email || '');

    // Variables de matrícula
    if (userData.matriculas && userData.matriculas.length > 0) {
      const activa = userData.matriculas.find(function(m) { return m.EstadoMatricula !== 'Retirado'; });
      if (activa) {
        r = r.replace(/\{seccion\}/gi, activa.Seccion || '');
        // {nombre_curso} se resuelve más abajo priorizando seccionData.nombreCurso
        r = r.replace(/\{saldo\}/gi, '$' + (activa.SaldoPendiente || 0).toFixed(2));
        r = r.replace(/\{precio_total\}/gi, '$' + (activa.PrecioTotal || 0).toFixed(2));
        r = r.replace(/\{total_pagado\}/gi, '$' + (activa.TotalPagado || 0).toFixed(2));
        r = r.replace(/\{modalidad\}/gi, activa.Modalidad || '');
        // Duración del simulador según la modalidad (de la hoja Modalidades)
        const benefVar = beneficiosDeModalidad(activa.Modalidad);
        r = r.replace(/\{sim_duracion\}/gi, (benefVar && benefVar.simuladorDuracion) ? benefVar.simuladorDuracion : '');
      }
    }

    // Variables de sección (si se cargaron)
    if (userData.seccionData) {
      // Priorizar el nombre real del curso de la sección (aplica a alumno y docente)
      if (userData.seccionData.nombreCurso) {
        r = r.replace(/\{nombre_curso\}/gi, userData.seccionData.nombreCurso);
      }
      r = r.replace(/\{fecha_inicio\}/gi, userData.seccionData.fechaInicio || 'Por confirmar');
      r = r.replace(/\{fecha_fin\}/gi, userData.seccionData.fechaFin || 'Por confirmar');
      r = r.replace(/\{horario\}/gi, userData.seccionData.frecuencia || '');
      r = r.replace(/\{nombre_docente\}/gi, userData.seccionData.docenteNombre || '');
      r = r.replace(/\{docente\}/gi, userData.seccionData.docenteNombre || '');
      r = r.replace(/\{docente_linkedin\}/gi, userData.seccionData.docenteLinkedIn || '');
      r = r.replace(/\{meet_url\}/gi, userData.seccionData.meetUrl || '');
      r = r.replace(/\{drive_url\}/gi, userData.seccionData.driveUrl || '');
      r = r.replace(/\{classroom_url\}/gi, userData.seccionData.classroomUrl || '');
    }
    // Fallback: si quedó sin resolver el nombre del curso, intentar en este orden:
    // 1) nombreCurso de la sección cargada, 2) NombreCurso de la matrícula/sección
    // activa, 3) el código de sección. Cubre alumno y docente.
    r = r.replace(/\{nombre_curso\}/gi, (function() {
      if (userData.seccionData && userData.seccionData.nombreCurso) {
        return userData.seccionData.nombreCurso;
      }
      const m = (userData.matriculas || []).find(function(x) { return x.EstadoMatricula !== 'Retirado'; });
      if (!m) return '';
      return m.NombreCurso || m.Seccion || '';
    })());
  }

  // Variables de config
  if (config) {
    r = r.replace(/\{simulador_url\}/gi, config['SIMULADOR_URL'] || '');
  }

  return r;
}

// ============================================
// BENEFICIOS POR MODALIDAD
// Lee la hoja "Modalidades" del sheet del bot y devuelve un mapa:
//   { basic: {consola, simulador, sim_duracion, grabaciones}, ... }
// Headers esperados: MODALIDAD | INCLUYE_CONSOLA | INCLUYE_SIMULADOR |
//                    SIMULADOR_DURACION | INCLUYE_GRABACIONES
// ============================================
let _modalidadesCache = null;
let _modalidadesCacheTimestamp = 0;

function getModalidades() {
  const ahora = Date.now();
  if (_modalidadesCache && (ahora - _modalidadesCacheTimestamp) < CACHE_DURATION_MS) {
    return _modalidadesCache;
  }
  const mapa = {};
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName('Modalidades');
    if (!sheet) { Logger.log('⚠️ Hoja Modalidades no encontrada'); return mapa; }
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return mapa;

    const headers = data[0].map(function(h) { return String(h).toUpperCase().trim(); });
    const idx = function(nombre) { return headers.indexOf(nombre); };
    const esSi = function(v) { return String(v).trim().toUpperCase() === 'SI' || String(v).trim().toUpperCase() === 'SÍ'; };

    for (let i = 1; i < data.length; i++) {
      const nombre = String(data[i][idx('MODALIDAD')] || '').trim();
      if (!nombre) continue;
      mapa[nombre.toLowerCase()] = {
        nombre: nombre,
        consola: esSi(data[i][idx('INCLUYE_CONSOLA')]),
        simulador: esSi(data[i][idx('INCLUYE_SIMULADOR')]),
        simuladorDuracion: String(data[i][idx('SIMULADOR_DURACION')] || '').trim(),
        grabaciones: esSi(data[i][idx('INCLUYE_GRABACIONES')]),
        examen: esSi(data[i][idx('INCLUYE_EXAMEN')])
      };
    }
    _modalidadesCache = mapa;
    _modalidadesCacheTimestamp = ahora;
    return mapa;
  } catch (error) {
    Logger.log('⚠️ Error modalidades: ' + error.toString());
    return _modalidadesCache || mapa;
  }
}

// Devuelve los beneficios de una modalidad concreta (o null si no está en la hoja)
function beneficiosDeModalidad(modalidad) {
  if (!modalidad) return null;
  const mapa = getModalidades();
  return mapa[String(modalidad).trim().toLowerCase()] || null;
}

// ============================================
// OBTENER DATOS DEL CRM POR PARÁMETRO
// ============================================
function obtenerDatosCRM(parametro, userData, config) {
  if (!userData) return null;

  // Obtener primera matrícula activa (no retirada)
  const matriculaActiva = (userData.matriculas || []).find(function(m) {
    return m.EstadoMatricula !== 'Retirado';
  });

  switch (parametro) {
    case 'fecha_inicio':
      return userData.seccionData ? userData.seccionData.fechaInicio : null;
    case 'fecha_fin':
      return userData.seccionData ? userData.seccionData.fechaFin : null;
    case 'meet_url':
      return userData.seccionData ? userData.seccionData.meetUrl : null;
    case 'drive_url':
      return userData.seccionData ? userData.seccionData.driveUrl : null;
    case 'classroom_url':
      return userData.seccionData ? userData.seccionData.classroomUrl : null;
    case 'docente':
      return userData.seccionData ? userData.seccionData.docenteNombre : null;
    case 'docente_linkedin':
      return userData.seccionData ? (userData.seccionData.docenteLinkedIn || null) : null;
    case 'horario':
      return userData.seccionData ? userData.seccionData.frecuencia : null;
    case 'saldo':
      if (matriculaActiva) {
        return '$' + (matriculaActiva.SaldoPendiente || 0).toFixed(2);
      }
      return null;
    case 'precio':
      if (matriculaActiva) {
        return '$' + (matriculaActiva.PrecioTotal || 0).toFixed(2);
      }
      return null;
    case 'modalidad':
      if (matriculaActiva) {
        return matriculaActiva.Modalidad || 'No definida';
      }
      return null;
    case 'lab_consola': {
      // Devuelve el TEXTO editable (de CONFIGURACION) según si el plan incluye
      // consola o no. Las plantillas son:
      //   MSG_CONSOLA_SI / MSG_CONSOLA_NO   (soportan {modalidad})
      if (!matriculaActiva) return null;
      var modalidad = (matriculaActiva.Modalidad || '').trim();
      var benef = beneficiosDeModalidad(modalidad);
      var incluyeConsola;
      if (benef) {
        incluyeConsola = benef.consola;
      } else {
        var lista = String((config && config['MODALIDADES_CON_CONSOLA']) || 'CERTIFIED,PRO')
          .split(',').map(function(m) { return m.trim().toLowerCase(); }).filter(function(m) { return m; });
        incluyeConsola = lista.indexOf(modalidad.toLowerCase()) !== -1;
      }
      var plantillaConsola = incluyeConsola
        ? (config['MSG_CONSOLA_SI'] || '✅ Tu plan *{modalidad}* incluye acceso a la consola cloud (AWS/Azure/GCP) que preparamos para tus prácticas. Las credenciales se comparten en clase y en el material de tu curso. Si no las encuentras, elige "Otra consulta".')
        : (config['MSG_CONSOLA_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye la cuenta de consola cloud creada por la academia. Puedes practicar con tu propia cuenta o consultar un upgrade de plan. Elige "Otra consulta" para hablar con un asesor.');
      return { texto: plantillaConsola };
    }
    case 'sim_incluye': {
      // Devuelve el TEXTO editable (de CONFIGURACION) según si el plan incluye
      // simulador. Plantillas: MSG_SIMULADOR_SI / MSG_SIMULADOR_NO
      // (soportan {modalidad} y {sim_duracion}).
      if (!matriculaActiva) return null;
      var modalidadSim = (matriculaActiva.Modalidad || '').trim();
      var benefSim = beneficiosDeModalidad(modalidadSim);
      if (!benefSim) return null;
      var plantillaSim = benefSim.simulador
        ? (config['MSG_SIMULADOR_SI'] || '✅ Tu plan *{modalidad}* incluye acceso al simulador de práctica por *{sim_duracion}*. Puedes acceder desde el menú Simulador.')
        : (config['MSG_SIMULADOR_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye el simulador de práctica. Elige "Otra consulta" para consultar un upgrade de plan.');
      return { texto: plantillaSim };
    }
    case 'grabaciones_incluye': {
      // Devuelve texto de bloqueo (MSG_GRABACIONES_NO) solo si NO incluye; si
      // incluye devuelve null para que el nodo entregue el enlace normal.
      if (!matriculaActiva) return null;
      var modalidadGrab = (matriculaActiva.Modalidad || '').trim();
      var benefGrab = beneficiosDeModalidad(modalidadGrab);
      if (benefGrab && !benefGrab.grabaciones) {
        return { texto: (config['MSG_GRABACIONES_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye grabaciones de las clases. Elige "Otra consulta" para consultar un upgrade de plan.'), bloqueo: true };
      }
      return null; // incluye grabaciones (o sin datos) → el nodo entrega el enlace normal
    }
    case 'cert_examen': {
      // ¿El plan incluye el examen de certificación? Solo CERTIFIED lo incluye.
      // El texto es editable en CONFIGURACION: MSG_CERT_SI / MSG_CERT_NO.
      if (!matriculaActiva) return null;
      var modalidadCert = (matriculaActiva.Modalidad || '').trim();
      var benefCert = beneficiosDeModalidad(modalidadCert);
      var incluyeExamen = benefCert ? benefCert.examen : false;
      var plantillaCert = incluyeExamen
        ? (config['MSG_CERT_SI'] || '🏅 Tu plan *{modalidad}* incluye el examen de certificación oficial. Para gestionarlo, envía un correo a students@example.com y un asesor coordinará contigo. ☺️')
        : (config['MSG_CERT_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye el examen de certificación oficial. Si deseas adquirirlo con nosotros, escríbenos a students@example.com y te ayudamos. ☺️');
      return { texto: plantillaCert };
    }
    case 'proxima_clase': {
      // Próxima clase de la sección seleccionada.
      // Fuente: Calendar; si no hay, fallback por FechaInicio+Frecuencia (primera clase futura).
      // Textos editables: MSG_PROXIMA_CLASE / MSG_PROXIMA_CLASE_NO
      if (!userData.seccionData) {
        return { texto: (config['MSG_PROXIMA_CLASE_NO'] || 'ℹ️ No hay clases programadas por ahora para tu sección. Escribe *0* para volver.') };
      }
      var prox = obtenerProximaClase(userData.seccionData.calendarEventId, userData.seccionData);
      if (!prox) {
        return { texto: (config['MSG_PROXIMA_CLASE_NO'] || 'ℹ️ No hay clases programadas por ahora para tu sección. Escribe *0* para volver.') };
      }
      var plantillaProx = config['MSG_PROXIMA_CLASE'] || '📅 Tu próxima clase es el *{prox_fecha}* a las *{prox_hora}*.';
      var textoProx = plantillaProx
        .replace(/\{prox_fecha\}/gi, prox.fecha)
        .replace(/\{prox_hora\}/gi, prox.hora);
      return { texto: textoProx, meetUrl: prox.meetUrl };
    }
    case 'fechas_clases': {
      // Lista TODAS las clases de la sección seleccionada (pasadas y próximas).
      // Fuente: Calendar; si no hay, fallback por FechaInicio+Frecuencia+Horas.
      // Texto editable: MSG_FECHAS_CLASES (encabezado) y MSG_FECHAS_CLASES_NO.
      if (!userData.seccionData) {
        return { texto: (config['MSG_FECHAS_CLASES_NO'] || 'ℹ️ Aún no hay fechas de clase registradas para tu sección. Escribe *0* para volver.') };
      }
      var clases = obtenerTodasLasClases(userData.seccionData.calendarEventId, userData.seccionData);
      if (!clases || clases.length === 0) {
        return { texto: (config['MSG_FECHAS_CLASES_NO'] || 'ℹ️ Aún no hay fechas de clase registradas para tu sección. Escribe *0* para volver.') };
      }
      var encabFechas = config['MSG_FECHAS_CLASES'] || '📆 *Fechas de clase:*';
      var lineas = clases.map(function(c) {
        var check = c.pasada ? '✔️' : '🔹';
        return check + ' ' + c.fecha + ' — ' + c.hora;
      });
      return { texto: encabFechas + '\n' + lineas.join('\n') };
    }
    case 'constancia': {
      // Constancia: se envía 7 días hábiles tras la última clase, solo si el
      // alumno tiene pago completo. Textos editables: MSG_CONSTANCIA,
      // MSG_CONSTANCIA_NO_PAGO, MSG_CONSTANCIA_NO_FIN.
      if (!matriculaActiva) return null;
      // ¿Pago completo? (umbral CRM: Pro/Basic total>=precio; Certify/Custom total>=precio-examen)
      var precioC = parseFloat(matriculaActiva.PrecioTotal) || 0;
      var pagadoC = parseFloat(matriculaActiva.TotalPagado) || 0;
      var examenC = parseFloat(matriculaActiva.MontoExamen) || 0;
      var modC = (matriculaActiva.Modalidad || 'Pro').trim();
      var umbralC = ((modC === 'Certify' || modC === 'Custom') && examenC > 0) ? (precioC - examenC) : precioC;
      var pagoCompleto = pagadoC >= umbralC && pagadoC > 0;
      if (!pagoCompleto) {
        return { texto: (config['MSG_CONSTANCIA_NO_PAGO'] || 'ℹ️ Tu constancia se emitirá cuando completes el pago de tu curso. Escribe *0* para volver.') };
      }
      // Necesita la última clase para calcular 7 días hábiles
      // (Calendar; si no hay, fallback por FechaInicio+Frecuencia+Horas)
      if (!userData.seccionData) {
        return { texto: (config['MSG_CONSTANCIA_NO_FIN'] || 'ℹ️ Tu constancia se enviará una vez finalizado el curso. Escribe *0* para volver.') };
      }
      var ultima = obtenerFechaUltimaClase(userData.seccionData.calendarEventId, userData.seccionData);
      if (!ultima) {
        return { texto: (config['MSG_CONSTANCIA_NO_FIN'] || 'ℹ️ Tu constancia se enviará una vez finalizado el curso. Escribe *0* para volver.') };
      }
      var fechaConstancia = sumarDiasHabiles(ultima, 7);
      var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      var fechaTxt = fechaConstancia.getDate() + ' de ' + meses[fechaConstancia.getMonth()] + ' de ' + fechaConstancia.getFullYear();
      var plantillaC = config['MSG_CONSTANCIA'] || '📜 Tu constancia se enviará a más tardar el *{fecha_constancia}* (7 días hábiles tras finalizar tu curso).';
      return { texto: plantillaC.replace(/\{fecha_constancia\}/gi, fechaTxt) };
    }
    case 'simulador_url':
      return config['SIMULADOR_URL'] || null;
    default:
      return null;
  }
}

// ============================================
// SUMA DE DÍAS HÁBILES (lunes a viernes) a una fecha dada.
// No considera feriados (solo fines de semana).
// ============================================
function sumarDiasHabiles(fecha, dias) {
  var resultado = new Date(fecha.getTime());
  var agregados = 0;
  while (agregados < dias) {
    resultado.setDate(resultado.getDate() + 1);
    var d = resultado.getDay();
    if (d !== 0 && d !== 6) agregados++; // 0=domingo, 6=sábado
  }
  return resultado;
}

// ============================================
// LOG
// ============================================
function registrarLog(telefono, nodoId, tipoAccion, derivado, tiempoMs, sesion) {
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName('LOG_CONVERSACIONES');
    if (!sheet) return;

    const audiencia = sesion ? (sesion.audiencia || '') : '';
    const nombre = sesion && sesion.userData ? sesion.userData.nombre : '';
    const nodoActual = sesion ? (sesion.nodoActual || '') : '';
    // Sección sobre la que se hizo la consulta (si el usuario ya eligió una)
    const seccion = sesion && sesion.seccionSeleccionada ? (sesion.seccionSeleccionada.Seccion || '') : '';

    sheet.appendRow([
      new Date(),
      telefono,
      audiencia,
      nombre,
      nodoActual,
      nodoId,
      tipoAccion,
      derivado ? 'SI' : 'NO',
      tiempoMs || 0,
      seccion
    ]);
  } catch (error) {
    Logger.log('⚠️ Error log: ' + error.toString());
  }
}

// ============================================
// INVALIDAR CACHE
// ============================================
function invalidarCache() {
  _configCache = null;
  _menuCache = null;
  _configCacheTimestamp = 0;
  _menuCacheTimestamp = 0;
  Logger.log('✅ Cache invalidado');
}
