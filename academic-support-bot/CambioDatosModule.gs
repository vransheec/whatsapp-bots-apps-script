// ============================================
// CAMBIO DE DATOS DEL ALUMNO (correo / celular) — lado BOT
// --------------------------------------------
// Flujo conversacional de varios pasos que:
//   1. Pregunta qué dato cambiar (1. Correo / 2. Celular)
//   2. Captura y valida el nuevo valor
//   3. Pide confirmación (sí/no)
//   4. Encola la solicitud en la hoja "SolicitudesCambio" del CRM y notifica
//      al área académica. El cambio NO se aplica en el momento: lo procesa el
//      CRM en su trigger diario de las 6:00 am (máx. 24 h hábiles).
//
// El estado vive en sesion.flujoCambioDatos = { paso, campo, valorNuevo }.
// "0"/"menu"/"cancelar" cancelan el flujo (se maneja en navegarMenu).
// ============================================

var HOJA_SOLICITUDES_CAMBIO_BOT = 'SolicitudesCambio';

// ============================================
// INICIO — preguntar qué dato cambiar
// ============================================
function iniciarFlujoCambioDatos(phoneNumber, sesion, config) {
  sesion.flujoCambioDatos = { paso: 'ELIGE_CAMPO' };
  guardarSesion(phoneNumber, sesion);

  const texto = (config['MSG_CAMBIO_ELEGIR'] || '¿Qué dato deseas actualizar?') +
    '\n\n1. 📧 Correo\n2. 📱 Celular' +
    '\n\n_' + (config['MSG_CAMBIO_INSTRUCCION'] || 'Responde con el número. Escribe *0* para cancelar.') + '_';
  enviarMensajeTexto(phoneNumber, texto);
}

// ============================================
// PROCESAR CADA PASO DEL FLUJO
// ============================================
function procesarFlujoCambioDatos(phoneNumber, input, sesion, config) {
  const estado = sesion.flujoCambioDatos || {};
  const paso = estado.paso;

  if (paso === 'ELIGE_CAMPO') {
    const numero = parseInt(input);
    if (numero === 1) {
      estado.campo = 'Email';
    } else if (numero === 2) {
      estado.campo = 'Telefono';
    } else {
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_OPCION_INVALIDA'] || '⚠️ Opción no válida. Responde 1 (Correo) o 2 (Celular). Escribe *0* para cancelar.');
      return;
    }
    estado.paso = 'CAPTURA_VALOR';
    sesion.flujoCambioDatos = estado;
    guardarSesion(phoneNumber, sesion);

    const pregunta = estado.campo === 'Email'
      ? (config['MSG_CAMBIO_PEDIR_CORREO'] || '📧 Escribe tu *nuevo correo*:')
      : (config['MSG_CAMBIO_PEDIR_CELULAR'] || '📱 Escribe tu *nuevo número de celular* (con código de país):');
    enviarMensajeTexto(phoneNumber, pregunta);
    return;
  }

  if (paso === 'CAPTURA_VALOR') {
    const valor = input.trim();
    if (estado.campo === 'Email') {
      if (!esCorreoValido(valor)) {
        enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_CORREO_INVALIDO'] || '⚠️ Ese correo no parece válido. Escríbelo de nuevo (ej: nombre@dominio.com). Escribe *0* para cancelar.');
        return;
      }
    } else {
      if (!esTelefonoValido(valor)) {
        enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_CELULAR_INVALIDO'] || '⚠️ Ese número no parece válido. Ingresa solo dígitos (mínimo 9). Escribe *0* para cancelar.');
        return;
      }
    }
    estado.valorNuevo = valor;
    estado.paso = 'CONFIRMA';
    sesion.flujoCambioDatos = estado;
    guardarSesion(phoneNumber, sesion);

    const etiqueta = estado.campo === 'Email' ? 'correo' : 'celular';
    const texto = (config['MSG_CAMBIO_CONFIRMAR'] || '¿Confirmas el cambio de tu {campo} a:') .replace('{campo}', etiqueta) +
      '\n\n*' + valor + '*' +
      '\n\n1. ✅ Sí, confirmar\n2. ❌ No, cancelar' +
      '\n\n_' + (config['MSG_CAMBIO_INSTRUCCION'] || 'Responde con el número. Escribe *0* para cancelar.') + '_';
    enviarMensajeTexto(phoneNumber, texto);
    return;
  }

  if (paso === 'CONFIRMA') {
    const inputLower = input.toLowerCase().trim();
    const confirma = (input.trim() === '1' || inputLower === 'si' || inputLower === 'sí' || inputLower === 'confirmar');
    const rechaza = (input.trim() === '2' || inputLower === 'no');

    if (rechaza) {
      delete sesion.flujoCambioDatos;
      guardarSesion(phoneNumber, sesion);
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_CANCELADO'] || '❎ Cambio cancelado.');
      mostrarMenuPrincipal(phoneNumber, sesion);
      return;
    }
    if (!confirma) {
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_OPCION_INVALIDA'] || '⚠️ Responde 1 para confirmar o 2 para cancelar.');
      return;
    }

    // Confirmado → encolar
    const ok = encolarSolicitudCambio(phoneNumber, sesion, estado, config);
    delete sesion.flujoCambioDatos;
    guardarSesion(phoneNumber, sesion);

    if (ok) {
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_RECIBIDO'] || '✅ Recibimos tu solicitud. El cambio se verá reflejado en un máximo de 24 horas hábiles.');
    } else {
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_ERROR'] || '⚠️ No pudimos registrar tu solicitud. Intenta más tarde o elige "Otra consulta".');
    }
    Utilities.sleep(400);
    enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');
    return;
  }

  // Estado inesperado → reiniciar
  delete sesion.flujoCambioDatos;
  guardarSesion(phoneNumber, sesion);
  mostrarMenuPrincipal(phoneNumber, sesion);
}

// ============================================
// ENCOLAR SOLICITUD EN EL CRM + NOTIFICAR AL ÁREA ACADÉMICA
// Escribe una fila PENDIENTE en la hoja SolicitudesCambio del CRM.
// (El bot comparte el scope de Sheets; aquí sí escribe en el CRM.)
// ============================================
function encolarSolicitudCambio(phoneNumber, sesion, estado, config) {
  try {
    const crmSheetId = config['CRM_SHEET_ID'];
    if (!crmSheetId) {
      Logger.log('❌ [encolarCambio] Falta CRM_SHEET_ID');
      return false;
    }
    const userData = sesion.userData || {};
    const alumnoId = userData.id || '';
    const valorAnterior = estado.campo === 'Email' ? (userData.email || '') : (userData.telefono || '');

    const ss = SpreadsheetApp.openById(crmSheetId);
    let sheet = ss.getSheetByName(HOJA_SOLICITUDES_CAMBIO_BOT);
    if (!sheet) {
      // Crear la hoja con headers si el CRM aún no la tiene
      sheet = ss.insertSheet(HOJA_SOLICITUDES_CAMBIO_BOT);
      sheet.appendRow([
        'Timestamp', 'AlumnoID', 'Telefono', 'Campo',
        'ValorAnterior', 'ValorNuevo', 'Estado', 'FechaProcesado', 'Detalle'
      ]);
    }

    sheet.appendRow([
      new Date(),           // Timestamp
      alumnoId,             // AlumnoID
      phoneNumber,          // Telefono (del contacto de WhatsApp)
      estado.campo,         // Campo (Email|Telefono)
      valorAnterior,        // ValorAnterior
      estado.valorNuevo,    // ValorNuevo
      'PENDIENTE',          // Estado
      '',                   // FechaProcesado
      ''                    // Detalle
    ]);

    // Notificar al área académica (visibilidad; el cambio lo aplica el trigger del CRM)
    const etiqueta = estado.campo === 'Email' ? 'Correo' : 'Celular';
    notificarAcademico(
      phoneNumber,
      userData.nombre || '',
      'Solicitud de cambio de datos (se aplica en el próximo procesamiento diario 6am).\n' +
      'Alumno ID: ' + alumnoId + '\n' +
      'Campo: ' + etiqueta + '\n' +
      'Valor anterior: ' + (valorAnterior || '(vacío)') + '\n' +
      'Valor nuevo: ' + estado.valorNuevo,
      config['EMAIL_ACADEMICO']
    );

    registrarLog(phoneNumber, 'CAMBIO_' + estado.campo, 'CAMBIO_DATOS_ENCOLADO', true, 0, sesion);
    return true;
  } catch (error) {
    Logger.log('❌ [encolarCambio] Error: ' + error.toString());
    return false;
  }
}

// ============================================
// VALIDACIONES
// ============================================
function esCorreoValido(valor) {
  const v = String(valor || '').trim();
  // Validación simple y robusta: algo@algo.dominio, sin espacios
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function esTelefonoValido(valor) {
  const digitos = String(valor || '').replace(/[^\d]/g, '');
  // Al menos 9 dígitos (celulares con o sin código de país)
  return digitos.length >= 9 && digitos.length <= 15;
}
