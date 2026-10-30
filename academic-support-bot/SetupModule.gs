// ============================================
// Cloud Academy Bot v2 - SetupModule.gs
// Funciones de setup inicial
// EJECUTAR UNA VEZ desde el editor de Apps Script
// ============================================

// ============================================
// CONFIGURAR PROPERTIES
// Los valores sensibles se agregan manualmente en:
// Apps Script → Configuración del proyecto → Propiedades del script
//
// Claves requeridas:
//   BOT_SHEET_ID, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
//   WHATSAPP_VERIFY_TOKEN, CRM_SHEET_ID, EMAIL_ACADEMICO, DEBUG_NUMEROS
// ============================================

// ============================================
// VER PROPERTIES — para verificar que estén bien
// ============================================
function verProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    // No logear tokens completos por seguridad
    const valor = all[key];
    Logger.log(key + ': ' + (valor.length > 20 ? valor.substring(0, 20) + '...' : valor));
  });
}

function crearHojaMenu() {
  const ss = SpreadsheetApp.openById(getBotSheetId());

  // Eliminar hoja MENU si ya existe
  const existente = ss.getSheetByName('MENU');
  if (existente) ss.deleteSheet(existente);

  const sheet = ss.insertSheet('MENU');

  // Headers
  const headers = ['ID', 'PADRE', 'AUDIENCIA', 'NIVEL', 'TITULO_OPCION', 'TIPO_NODO', 'TIPO_ACCION', 'PARAMETRO_ACCION', 'TEXTO_RESPUESTA', 'TIPO_ADJUNTO', 'URL_ADJUNTO', 'TEXTO_BOTON_URL', 'ACTIVO', 'ORDEN'];
  sheet.appendRow(headers);

  // ==============================
  // NODOS RAÍZ
  // ==============================
  var datos = [
    // ALUMNO ROOT
    ['ALUMNO_ROOT', '', 'ALUMNO', '0', '', 'MENU', '', '', '¿En qué puedo ayudarte?', '', '', '', 'SI', '0'],

    // ALUMNO NIVEL 1
    ['A_CURSO', 'ALUMNO_ROOT', 'ALUMNO', '1', '📚 Mi Curso', 'MENU', '', '', 'Selecciona una opción sobre tu curso:', '', '', '', 'SI', '1'],
    ['A_SIMULADOR', 'ALUMNO_ROOT', 'ALUMNO', '1', '🖥️ Simulador', 'MENU', '', '', 'Selecciona una opción sobre el simulador:', '', '', '', 'SI', '2'],
    ['A_LAB', 'ALUMNO_ROOT', 'ALUMNO', '1', '🧪 Laboratorios (consola cloud)', 'MENU', '', '', 'Los laboratorios son las consolas de AWS, Azure o GCP que usas en clase. Selecciona una opción:', '', '', '', 'SI', '3'],
    ['A_PAGOS', 'ALUMNO_ROOT', 'ALUMNO', '1', '💳 Pagos', 'MENU', '', '', 'Selecciona una opción sobre pagos:', '', '', '', 'SI', '4'],
    ['A_TRAMITES', 'ALUMNO_ROOT', 'ALUMNO', '1', '📋 Trámites', 'MENU', '', '', 'Selecciona una opción:', '', '', '', 'SI', '5'],
    ['A_OTRO', 'ALUMNO_ROOT', 'ALUMNO', '1', '❓ Otra consulta', 'ACCION', 'DERIVAR', '', 'Tu consulta será atendida por un asesor del área académica. Te contactaremos a la brevedad.', '', '', '', 'SI', '6'],

    // ALUMNO → MI CURSO (nivel 2)
    ['A_CURSO_FECHAS', 'A_CURSO', 'ALUMNO', '2', '📅 Fechas e inicio', 'ACCION', 'CRM_CONSULTA', 'fecha_inicio', '📅 Tu curso *{nombre_curso}* inicia el *{fecha_inicio}*.\nFrecuencia: {horario}', '', '', '', 'SI', '1'],
    ['A_CURSO_MEET', 'A_CURSO', 'ALUMNO', '2', '🔗 Clase en vivo', 'ACCION', 'CRM_CONSULTA', 'meet_url', '🔗 Este es tu enlace de clase en vivo. Te recomendamos ingresar 5 minutos antes.', 'BOTON_URL', '{meet_url}', 'Unirse a la clase', 'SI', '2'],
    ['A_CURSO_PROXIMA', 'A_CURSO', 'ALUMNO', '2', '⏰ Próxima clase', 'ACCION', 'CRM_CONSULTA', 'proxima_clase', '(El texto se edita en CONFIGURACION: MSG_PROXIMA_CLASE)', '', '', 'Unirse a la clase', 'SI', '3'],
    ['A_CURSO_CLASSROOM', 'A_CURSO', 'ALUMNO', '2', '💻 Aula Classroom', 'ACCION', 'CRM_CONSULTA', 'classroom_url', '💻 Este es el aula de Google Classroom de tu curso *{nombre_curso}*, donde encontrarás actividades y anuncios.', 'BOTON_URL', '{classroom_url}', 'Abrir Classroom', 'SI', '3'],
    ['A_CURSO_GRAB', 'A_CURSO', 'ALUMNO', '2', '🎥 Grabaciones', 'ACCION', 'CRM_CONSULTA', 'drive_url', '🎥 Las grabaciones están en tu carpeta del curso. Se suben dentro de las 24 horas posteriores a la clase.', 'BOTON_URL', '{drive_url}', 'Ver grabaciones', 'SI', '4'],
    ['A_CURSO_MATERIAL', 'A_CURSO', 'ALUMNO', '2', '📁 Material', 'ACCION', 'CRM_CONSULTA', 'drive_url', '📁 Todo el material del curso está organizado en tu carpeta de Drive.', 'BOTON_URL', '{drive_url}', 'Abrir material', 'SI', '5'],
    ['A_CURSO_DOCENTE', 'A_CURSO', 'ALUMNO', '2', '👨‍🏫 Mi Docente', 'ACCION', 'CRM_CONSULTA', 'docente', '👨‍🏫 El docente de tu curso es *{nombre_docente}*.', '', '', '', 'SI', '6'],

    // ALUMNO → SIMULADOR (nivel 2)
    ['A_SIM_ACCESO', 'A_SIMULADOR', 'ALUMNO', '2', '🔑 Accesos', 'ACCION', 'ENLACE', 'simulador_url', '🔑 Puedes acceder al simulador desde el siguiente enlace usando las credenciales enviadas por email.', 'BOTON_URL', '{simulador_url}', 'Ir al Simulador', 'SI', '1'],
    ['A_SIM_PLAN', 'A_SIMULADOR', 'ALUMNO', '2', '❓ ¿Mi plan incluye simulador?', 'ACCION', 'CRM_CONSULTA', 'sim_incluye', '(El texto se edita en CONFIGURACION: MSG_SIMULADOR_SI / MSG_SIMULADOR_NO)', '', '', '', 'SI', '2'],
    ['A_SIM_PROBLEMA', 'A_SIMULADOR', 'ALUMNO', '2', '🔧 Problemas', 'ACCION', 'DERIVAR', '', '🔧 Si tienes problemas con el simulador, describe el error que ves y un asesor te ayudará a la brevedad.', '', '', '', 'SI', '3'],

    // ALUMNO → LABORATORIOS (consolas cloud AWS/Azure/GCP usadas en clase; depende del plan)
    ['A_LAB_PLAN', 'A_LAB', 'ALUMNO', '2', '❓ ¿Mi plan incluye consola?', 'ACCION', 'CRM_CONSULTA', 'lab_consola', '(El texto se edita en CONFIGURACION: MSG_CONSOLA_SI / MSG_CONSOLA_NO)', '', '', '', 'SI', '1'],
    ['A_LAB_ACCESO', 'A_LAB', 'ALUMNO', '2', '🔑 ¿Cómo accedo?', 'ACCION', 'TEXTO', '', '🔑 Si tu plan incluye la consola cloud, las credenciales de acceso (AWS/Azure/GCP) se comparten durante la clase y en el material de tu curso. Revisa tu carpeta de Drive o el email de bienvenida.', '', '', '', 'SI', '2'],
    ['A_LAB_PROBLEMA', 'A_LAB', 'ALUMNO', '2', '🔧 Tengo un problema', 'ACCION', 'DERIVAR', '', '🔧 Cuéntanos qué problema tienes con la consola/laboratorio y un asesor te ayudará a la brevedad.', '', '', '', 'SI', '3'],

    // ALUMNO → PAGOS (nivel 2)
    ['A_PAGOS_CUOTAS', 'A_PAGOS', 'ALUMNO', '2', '📋 Cuotas pendientes', 'ACCION', 'CRM_CONSULTA', 'saldo', '💰 Tu saldo pendiente es: *{saldo}*\nTotal pagado hasta ahora: {total_pagado}', '', '', '', 'SI', '1'],
    ['A_PAGOS_TOTAL', 'A_PAGOS', 'ALUMNO', '2', '💰 Costo total', 'ACCION', 'CRM_CONSULTA', 'precio', '💳 El costo total de tu programa es: *{precio_total}*\nModalidad: {modalidad}', '', '', '', 'SI', '2'],

    // ALUMNO → TRÁMITES (nivel 2)
    ['A_TRAM_CONST', 'A_TRAMITES', 'ALUMNO', '2', '📜 Constancia', 'ACCION', 'DERIVAR', '', '📜 Para solicitar una constancia, un asesor del área académica procesará tu solicitud. Te contactaremos.', '', '', '', 'SI', '1'],
    ['A_TRAM_CAMBIO', 'A_TRAMITES', 'ALUMNO', '2', '🔄 Cambio de grupo', 'ACCION', 'DERIVAR', '', '🔄 Las solicitudes de cambio de grupo se gestionan con el área académica. Un asesor revisará tu caso.', '', '', '', 'SI', '2'],
    ['A_TRAM_CERT', 'A_TRAMITES', 'ALUMNO', '2', '🏅 Certificación', 'ACCION', 'TEXTO', '', '🏅 Para obtener tu certificado de participación necesitas cumplir los requisitos del programa (asistencia, actividades, pagos al día). Consulta con el área académica para verificar tu estado.', '', '', '', 'SI', '3'],
  ];

  // ==============================
  // DOCENTE
  // ==============================
  var datosDocente = [
    // DOCENTE ROOT
    ['DOCENTE_ROOT', '', 'DOCENTE', '0', '', 'MENU', '', '', '¿En qué puedo ayudarte?', '', '', '', 'SI', '0'],

    // DOCENTE NIVEL 1
    ['D_CLASE', 'DOCENTE_ROOT', 'DOCENTE', '1', '📚 Mi Clase', 'MENU', '', '', 'Selecciona una opción:', '', '', '', 'SI', '1'],
    ['D_PAGOS', 'DOCENTE_ROOT', 'DOCENTE', '1', '💳 Honorarios / Pagos', 'ACCION', 'DERIVAR', '', '💳 Tu consulta sobre honorarios o pagos será procesada por el área administrativa. Cuéntanos el detalle y te contactaremos.', '', '', '', 'SI', '2'],
    ['D_SOPORTE', 'DOCENTE_ROOT', 'DOCENTE', '1', '🔧 Soporte técnico', 'ACCION', 'DERIVAR', '', '🔧 Cuéntanos qué problema técnico tienes (accesos, plataforma, etc.) y un asesor te brindará soporte a la brevedad.', '', '', '', 'SI', '3'],
    ['D_OTRO', 'DOCENTE_ROOT', 'DOCENTE', '1', '❓ Otra consulta', 'ACCION', 'DERIVAR', '', 'Tu consulta será atendida por el área académica. Te contactaremos a la brevedad.', '', '', '', 'SI', '4'],

    // DOCENTE → MI CLASE (nivel 2)
    ['D_CLASE_MEET', 'D_CLASE', 'DOCENTE', '2', '🔗 Enlace Meet', 'ACCION', 'CRM_CONSULTA', 'meet_url', '🔗 Este es el enlace de la clase en vivo de tu sección *{nombre_curso}*. Ingresa unos minutos antes.', 'BOTON_URL', '{meet_url}', 'Unirse a la clase', 'SI', '1'],
    ['D_CLASE_PROXIMA', 'D_CLASE', 'DOCENTE', '2', '⏰ Próxima clase', 'ACCION', 'CRM_CONSULTA', 'proxima_clase', '(El texto se edita en CONFIGURACION: MSG_PROXIMA_CLASE)', '', '', 'Unirse a la clase', 'SI', '6'],
    ['D_CLASE_CLASSROOM', 'D_CLASE', 'DOCENTE', '2', '💻 Aula Classroom', 'ACCION', 'CRM_CONSULTA', 'classroom_url', '💻 Este es el aula de Google Classroom de tu sección *{nombre_curso}*.', 'BOTON_URL', '{classroom_url}', 'Abrir Classroom', 'SI', '2'],
    ['D_CLASE_MATERIAL', 'D_CLASE', 'DOCENTE', '2', '📁 Carpeta Drive', 'ACCION', 'CRM_CONSULTA', 'drive_url', '📁 Esta es la carpeta de Drive de tu sección *{nombre_curso}* con todo el material.', 'BOTON_URL', '{drive_url}', 'Abrir carpeta', 'SI', '3'],
    ['D_CLASE_GRAB', 'D_CLASE', 'DOCENTE', '2', '🎥 Grabaciones', 'ACCION', 'CRM_CONSULTA', 'drive_url', '🎥 Las grabaciones de tu sección *{nombre_curso}* se guardan en la carpeta de Drive.', 'BOTON_URL', '{drive_url}', 'Ver grabaciones', 'SI', '4'],
    ['D_CLASE_FECHAS', 'D_CLASE', 'DOCENTE', '2', '📅 Fechas de clase', 'ACCION', 'CRM_CONSULTA', 'fecha_inicio', '📅 Tu sección *{nombre_curso}* inicia el *{fecha_inicio}*.\nFrecuencia: {horario}', '', '', '', 'SI', '5'],

  ];

  // Escribir todos los datos
  datos.concat(datosDocente).forEach(function(fila) {
    sheet.appendRow(fila);
  });

  // Formatear
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  Logger.log('✅ Hoja MENU creada con ' + (datos.length + datosDocente.length) + ' nodos');
  return 'Hoja MENU creada exitosamente con ' + (datos.length + datosDocente.length) + ' nodos';
}

// ============================================
// CREAR HOJA SESIONES — ejecutar UNA VEZ
// ============================================
function crearHojaSesiones() {
  const ss = SpreadsheetApp.openById(getBotSheetId());

  const existente = ss.getSheetByName('SESIONES');
  if (existente) {
    Logger.log('⚠️ La hoja SESIONES ya existe');
    return;
  }

  const sheet = ss.insertSheet('SESIONES');
  const headers = ['TELEFONO', 'DATOS_JSON', 'ULTIMA_ACTIVIDAD'];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 500);
  sheet.setColumnWidth(3, 180);

  Logger.log('✅ Hoja SESIONES creada');
}

// ============================================
// ACTUALIZAR HOJA LOG_CONVERSACIONES — ejecutar UNA VEZ
// Agrega las nuevas columnas: AUDIENCIA, NOMBRE, NODO_ACTUAL
// ============================================
function actualizarHojaLog() {
  const ss = SpreadsheetApp.openById(getBotSheetId());
  const sheet = ss.getSheetByName('LOG_CONVERSACIONES');

  if (!sheet) {
    // Crear desde cero
    const nueva = ss.insertSheet('LOG_CONVERSACIONES');
    const headers = ['FECHA', 'TELEFONO', 'AUDIENCIA', 'NOMBRE', 'NODO_ACTUAL', 'NODO_ACCION', 'TIPO_ACCION', 'DERIVADO', 'TIEMPO_MS', 'SECCION'];
    nueva.appendRow(headers);
    nueva.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
    nueva.setFrozenRows(1);
    Logger.log('✅ Hoja LOG_CONVERSACIONES creada con nuevos headers');
    return;
  }

  // Si ya existe, verificar si tiene los headers nuevos
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('AUDIENCIA') === -1) {
    // Reemplazar headers (los datos viejos quedarán desalineados, pero es log histórico)
    Logger.log('⚠️ La hoja LOG_CONVERSACIONES tiene headers viejos. Creá una nueva o actualizá manualmente los headers a: FECHA, TELEFONO, AUDIENCIA, NOMBRE, NODO_ACTUAL, NODO_ACCION, TIPO_ACCION, DERIVADO, TIEMPO_MS');
  } else {
    Logger.log('✅ Hoja LOG_CONVERSACIONES ya tiene el formato correcto');
  }
}


// ============================================
// CREAR HOJA MODALIDADES — ejecutar UNA VEZ
// Matriz de beneficios por modalidad. El equipo académico puede editarla luego.
// ============================================
function crearHojaModalidades() {
  const ss = SpreadsheetApp.openById(getBotSheetId());

  const existente = ss.getSheetByName('Modalidades');
  if (existente) ss.deleteSheet(existente);

  const sheet = ss.insertSheet('Modalidades');
  const headers = ['MODALIDAD', 'INCLUYE_CONSOLA', 'INCLUYE_SIMULADOR', 'SIMULADOR_DURACION', 'INCLUYE_GRABACIONES', 'INCLUYE_EXAMEN'];
  sheet.appendRow(headers);

  const filas = [
    ['BASIC',     'NO', 'NO', '',        'SI', 'NO'],
    ['GO',        'NO', 'SI', '1 mes',   'NO', 'NO'],
    ['CERTIFIED', 'SI', 'SI', '3 meses', 'SI', 'SI'],
    ['PRO',       'SI', 'SI', '3 meses', 'SI', 'NO']
  ];
  filas.forEach(function(f) { sheet.appendRow(f); });

  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  Logger.log('✅ Hoja Modalidades creada con ' + filas.length + ' modalidades');
  return 'Hoja Modalidades creada con ' + filas.length + ' modalidades';
}

// ============================================
// POBLAR CONFIGURACION — ejecutar UNA VEZ (o cuando falten claves)
// Agrega a la hoja CONFIGURACION las claves de mensajes editables que el bot
// usa, con sus textos por defecto. NO sobrescribe las que ya existan, solo
// agrega las que falten. Seguro de ejecutar varias veces.
// ============================================
function poblarConfiguracion() {
  const ss = SpreadsheetApp.openById(getBotSheetId());
  let sheet = ss.getSheetByName('CONFIGURACION');

  // Crear la hoja si no existe
  if (!sheet) {
    sheet = ss.insertSheet('CONFIGURACION');
    sheet.appendRow(['CLAVE', 'VALOR']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
    sheet.setFrozenRows(1);
  }

  // Claves y textos por defecto (clave -> valor)
  const defaults = {
    // Bienvenida / navegación
    'MENSAJE_BIENVENIDA': '👋 Hola, soy el asistente académico de Cloud Academy. ¿Con quién hablo?',
    'MENSAJE_INSTRUCCION_MENU': 'Responde con el número de tu opción.',
    'MENSAJE_VOLVER_MENU': '_Escribe *0* para volver o *9* para el menú principal._',
    'MENSAJE_OPCION_INVALIDA': '⚠️ Opción no válida. Ingresa un número del menú o escribe *0* para volver.',
    'MENSAJE_OPCION_INVALIDA_CURSO': '⚠️ Opción no válida. Ingresa el número del curso.',
    'MENSAJE_ENLACE_NO_DISPONIBLE': 'ℹ️ No hay una clase en vivo programada por ahora para tu sección, o el enlace aún no está disponible. Si crees que es un error, escribe *0* para volver y elige "Otra consulta".',

    // Selección de curso (agrupada por provider) / sección
    'MENSAJE_SELECCIONAR_CURSO': '📚 ¿Sobre qué curso consultas?',
    'MENSAJE_SELECCIONAR_CURSO_DOCENTE': '📚 ¿Sobre qué curso consultas?',
    'MENSAJE_SELECCIONAR_SECCION': '📅 Elige la sección:',

    // Derivación / no registrado
    'MENSAJE_NO_REGISTRADO': 'No encontramos tu registro en nuestro sistema. Un asesor del área académica se comunicará contigo pronto.',
    'MENSAJE_NO_ENTENDIDO': 'Por ahora solo puedo procesar mensajes de texto. Escribe el número de tu opción.',
    'MENSAJE_DERIVAR': 'Tu consulta será atendida por un asesor del área académica. Te contactaremos a la brevedad.',
    'MENSAJE_DERIVACION_CONFIRMADA': '✅ Recibimos tu mensaje. Un asesor se comunicará contigo en un máximo de 48 horas hábiles.',

    // Beneficios por modalidad (soportan {modalidad} y {sim_duracion})
    'MSG_CONSOLA_SI': '✅ Tu plan *{modalidad}* incluye acceso a la consola cloud (AWS/Azure/GCP) que preparamos para tus prácticas. Las credenciales se comparten en clase y en el material de tu curso. Si no las encuentras, elige "Otra consulta".',
    'MSG_CONSOLA_NO': 'ℹ️ Tu plan *{modalidad}* no incluye la cuenta de consola cloud creada por la academia. Puedes practicar con tu propia cuenta o consultar un upgrade de plan. Elige "Otra consulta" para hablar con un asesor.',
    'MSG_SIMULADOR_SI': '✅ Tu plan *{modalidad}* incluye acceso al simulador de práctica por *{sim_duracion}*. Puedes acceder desde el menú Simulador.',
    'MSG_SIMULADOR_NO': 'ℹ️ Tu plan *{modalidad}* no incluye el simulador de práctica. Elige "Otra consulta" para consultar un upgrade de plan.',
    'MSG_GRABACIONES_NO': 'ℹ️ Tu plan *{modalidad}* no incluye grabaciones de las clases. Elige "Otra consulta" para consultar un upgrade de plan.',
    'MSG_CERT_SI': '🏅 Tu plan *{modalidad}* incluye el examen de certificación oficial. Para gestionarlo, envía un correo a students@example.com y un asesor coordinará contigo. ☺️',
    'MSG_CERT_NO': 'ℹ️ Tu plan *{modalidad}* no incluye el examen de certificación oficial. Si deseas adquirirlo con nosotros, escríbenos a students@example.com y te ayudamos. ☺️',

    // Próxima clase (soporta {prox_fecha} y {prox_hora})
    'MSG_PROXIMA_CLASE': '📅 Tu próxima clase es el *{prox_fecha}* a las *{prox_hora}*.',
    'MSG_PROXIMA_CLASE_NO': 'ℹ️ No hay clases programadas por ahora para tu sección. Escribe *0* para volver.',

    // Mensaje inválido en el paso de elegir sección (distinto al de curso)
    'MENSAJE_OPCION_INVALIDA_SECCION': '⚠️ Opción no válida. Ingresa el número de la sección.',

    // Cambio de datos del alumno (correo / celular)
    'MSG_CAMBIO_ELEGIR': '¿Qué dato deseas actualizar?',
    'MSG_CAMBIO_INSTRUCCION': 'Responde con el número. Escribe *0* para cancelar.',
    'MSG_CAMBIO_OPCION_INVALIDA': '⚠️ Opción no válida. Responde 1 (Correo) o 2 (Celular). Escribe *0* para cancelar.',
    'MSG_CAMBIO_PEDIR_CORREO': '📧 Escribe tu *nuevo correo*:',
    'MSG_CAMBIO_PEDIR_CELULAR': '📱 Escribe tu *nuevo número de celular* (con código de país):',
    'MSG_CAMBIO_CORREO_INVALIDO': '⚠️ Ese correo no parece válido. Escríbelo de nuevo (ej: nombre@dominio.com). Escribe *0* para cancelar.',
    'MSG_CAMBIO_CELULAR_INVALIDO': '⚠️ Ese número no parece válido. Ingresa solo dígitos (mínimo 9). Escribe *0* para cancelar.',
    'MSG_CAMBIO_CONFIRMAR': '¿Confirmas el cambio de tu {campo} a:',
    'MSG_CAMBIO_RECIBIDO': '✅ Recibimos tu solicitud. El cambio se verá reflejado en un máximo de 24 horas hábiles.',
    'MSG_CAMBIO_CANCELADO': '❎ Cambio cancelado.',
    'MSG_CAMBIO_ERROR': '⚠️ No pudimos registrar tu solicitud. Intenta más tarde o elige "Otra consulta".',
    'MSG_CAMBIO_SOLO_ALUMNO': 'ℹ️ Esta opción está disponible solo para alumnos.',

    // Encabezado de sección (en negrita, arriba de cada respuesta). Variables: {curso} {seccion}
    'MSG_ENCABEZADO_SECCION': '*{curso} ({seccion})*',

    // Bloqueos por estado de la sección
    'MSG_NO_DISPONIBLE_FINALIZADA': 'ℹ️ Esta sección ya finalizó, por lo que no hay próxima clase, enlace de reunión ni horario vigente.',
    'MSG_NO_DISPONIBLE_PROGRAMADA': 'ℹ️ El curso aún no inicia. El enlace de la clase y la próxima sesión estarán disponibles el día de inicio.',

    // Bloqueo de materiales por pago pendiente
    'MSG_MATERIALES_NO_PAGO': 'ℹ️ Los materiales, grabaciones y classroom estarán disponibles cuando completes el pago de tu curso. Mientras tanto puedes consultar tus fechas y horarios. Escribe *0* para volver.',

    // Fechas de todas las clases. Variable de encabezado editable.
    'MSG_FECHAS_CLASES': '📆 *Fechas de clase:*',
    'MSG_FECHAS_CLASES_NO': 'ℹ️ Aún no hay fechas de clase registradas para tu sección. Escribe *0* para volver.',

    // Constancia (7 días hábiles tras la última clase, solo pago completo). Variable: {fecha_constancia}
    'MSG_CONSTANCIA': '📜 Tu constancia se enviará a más tardar el *{fecha_constancia}* (7 días hábiles tras finalizar tu curso).',
    'MSG_CONSTANCIA_NO_PAGO': 'ℹ️ Tu constancia se emitirá cuando completes el pago de tu curso. Escribe *0* para volver.',
    'MSG_CONSTANCIA_NO_FIN': 'ℹ️ Tu constancia se enviará una vez finalizado el curso. Escribe *0* para volver.',
    'MSG_CONSTANCIA_ELEGIR': '📜 ¿De qué curso quieres tu constancia?',
    'MSG_CONSTANCIA_SIN_SECCIONES': 'ℹ️ No tienes cursos registrados para emitir constancia. Escribe *0* para volver.',

    // Honorarios del docente. Variables: {seccion} {horas} {tarifa} {total}
    'MSG_HONORARIOS': '💰 Honorarios de *{seccion}*:\n{horas} h × ${tarifa} = *${total}*',
    'MSG_HONORARIOS_ELEGIR': '💰 ¿De qué sección quieres ver tus honorarios?',
    'MSG_HONORARIOS_SIN_SECCIONES': 'ℹ️ No tienes secciones con honorarios para mostrar. Escribe *0* para volver.',
    'MSG_HONORARIOS_NO_DATOS': 'ℹ️ No pude calcular los honorarios de esa sección. Escribe *0* para volver.',
    'MSG_HONORARIOS_SOLO_DOCENTE': 'ℹ️ Esta opción está disponible solo para docentes.',

    // Modalidades con consola (fallback si no existe la hoja Modalidades)
    'MODALIDADES_CON_CONSOLA': 'CERTIFIED,PRO'
  };

  // Leer claves existentes para no duplicar
  const data = sheet.getDataRange().getValues();
  const existentes = {};
  for (let i = 1; i < data.length; i++) {
    const clave = String(data[i][0] || '').trim();
    if (clave) existentes[clave] = true;
  }

  let agregadas = 0;
  Object.keys(defaults).forEach(function(clave) {
    if (!existentes[clave]) {
      sheet.appendRow([clave, defaults[clave]]);
      agregadas++;
    }
  });

  Logger.log('✅ Configuración poblada. Claves agregadas: ' + agregadas +
             ' (las que ya existían no se tocaron).');
  return 'Claves agregadas: ' + agregadas;
}

// ============================================
// DIAGNÓSTICO ALUMNO — ejecutar con un teléfono real
// Muestra matrículas, estados y cómo quedan tras cada filtro.
// ============================================
function testAlumnoMatriculas() {
  const telefono = '51999999999'; // <-- CAMBIAR por el teléfono del alumno
  const al = buscarAlumnoPorTelefono(telefono);

  if (!al) { Logger.log('❌ No se encontró alumno con teléfono ' + telefono); return; }

  Logger.log('🎓 Alumno: ' + al.nombre + ' (ID: ' + al.id + ')');
  Logger.log('📋 Matrículas devueltas por el CRM: ' + al.matriculas.length);
  al.matriculas.forEach(function(m, i) {
    Logger.log('   ' + (i + 1) + '. Seccion="' + m.Seccion + '" | Curso="' + m.NombreCurso +
               '" | EstadoMatricula="' + m.EstadoMatricula + '" | EstadoSeccion="' + m.EstadoSeccion + '"');
  });

  const activas = al.matriculas.filter(function(m) { return m.EstadoMatricula !== 'Retirado'; });
  Logger.log('✅ Tras filtrar Retirado (activas): ' + activas.length);

  const vigentes = activas.filter(function(s) { return s.EstadoSeccion !== 'FINALIZADA'; });
  Logger.log('✅ Tras filtrar FINALIZADA (vigentes): ' + vigentes.length);
  vigentes.forEach(function(m) {
    Logger.log('   → ' + m.Seccion + ' (' + m.NombreCurso + ') [' + m.EstadoSeccion + ']');
  });

  // Agrupar por curso
  const mapa = {};
  vigentes.forEach(function(s) {
    const clave = s.NombreCurso || s.Seccion;
    if (!mapa[clave]) mapa[clave] = 0;
    mapa[clave]++;
  });
  Logger.log('📚 Cursos distintos tras agrupar: ' + Object.keys(mapa).length);
  Object.keys(mapa).forEach(function(c) { Logger.log('   - ' + c + ': ' + mapa[c] + ' sección(es)'); });
}

// ============================================
// DIAGNÓSTICO FECHAS DE SECCIONES — ver valores crudos de columnas 13 y 14
// ============================================
function testFechasSecciones() {
  const config = getConfig();
  const ss = SpreadsheetApp.openById(config['CRM_SHEET_ID']);
  const sheet = ss.getSheetByName('Secciones');
  const data = sheet.getDataRange().getValues();

  // Encabezados para ubicar columnas
  Logger.log('HEADERS: ' + data[0].map(function(h, i) { return i + '=' + h; }).join(' | '));

  const codigos = ['GACE0626-A', 'SAA0626-A', 'CLF0726-A'];
  for (let i = 1; i < data.length; i++) {
    const cod = String(data[i][0] || '').trim();
    if (codigos.indexOf(cod) === -1) continue;
    const ini = data[i][13];
    const fin = data[i][14];
    const estadoCrm = data[i][12]; // columna Estado (M)
    Logger.log('SECCION ' + cod +
      ' | col12(estado)="' + estadoCrm + '"' +
      ' | col13(inicio)="' + ini + '" tipo=' + (ini instanceof Date ? 'Date' : typeof ini) +
      ' | col14(fin)="' + fin + '" tipo=' + (fin instanceof Date ? 'Date' : typeof fin) +
      ' | estadoNormalizado=' + calcularEstadoSeccion(estadoCrm));
  }
  Logger.log('HOY: ' + new Date());
}

// ============================================
// DIAGNÓSTICO — volcar todas las columnas de una sección y una matrícula
// para ubicar la columna de ESTADO del curso en el CRM
// ============================================
function testColumnasCRM() {
  const config = getConfig();
  const ss = SpreadsheetApp.openById(config['CRM_SHEET_ID']);

  // Secciones
  const secc = ss.getSheetByName('Secciones');
  const dataS = secc.getDataRange().getValues();
  Logger.log('=== SECCIONES: headers ===');
  dataS[0].forEach(function(h, i) { Logger.log('  col ' + i + ' = ' + h); });
  // Volcar la fila de GACE0626-A
  for (let i = 1; i < dataS.length; i++) {
    if (String(dataS[i][0]).trim() === 'GACE0626-A') {
      Logger.log('=== SECCION GACE0626-A: valores ===');
      dataS[i].forEach(function(v, j) { Logger.log('  col ' + j + ' = "' + v + '"'); });
      break;
    }
  }

  // Matriculas
  const mat = ss.getSheetByName('Matriculas');
  const dataM = mat.getDataRange().getValues();
  Logger.log('=== MATRICULAS: headers ===');
  dataM[0].forEach(function(h, i) { Logger.log('  col ' + i + ' = ' + h); });
}
