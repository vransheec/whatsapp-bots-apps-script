// ============================================
// Cloud Academy Bot v2 - SessionModule.gs
// Manejo de sesiones en hoja SESIONES
// ============================================

const SESSION_EXPIRY_HOURS = 24;
const SESSION_SHEET_NAME = 'SESIONES';

// ============================================
// OBTENER SESIÓN
// ============================================
function obtenerSesion(phoneNumber) {
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName(SESSION_SHEET_NAME);
    if (!sheet) return crearSesionNueva();

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === phoneNumber) {
        const json = String(data[i][1] || '');
        if (!json) return crearSesionNueva();
        const sesion = JSON.parse(json);
        if (sesionExpirada(sesion)) {
          // Sesión expirada (24h de inactividad): se descarta por completo y el
          // usuario arranca una sesión nueva (verá el mensaje de bienvenida y
          // volverá a identificarse). Se borra la fila para no dejar basura.
          limpiarSesion(phoneNumber);
          return crearSesionNueva();
        }
        return sesion;
      }
    }
    return crearSesionNueva();
  } catch (error) {
    Logger.log('⚠️ Error obteniendo sesión: ' + error.toString());
    return crearSesionNueva();
  }
}

// ============================================
// GUARDAR SESIÓN
// ============================================
function guardarSesion(phoneNumber, sesion) {
  try {
    sesion.ultimaActividad = Date.now();
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName(SESSION_SHEET_NAME);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === phoneNumber) {
        // Actualizar fila existente
        sheet.getRange(i + 1, 2).setValue(JSON.stringify(sesion));
        sheet.getRange(i + 1, 3).setValue(new Date());
        return;
      }
    }
    // Nueva fila
    sheet.appendRow([phoneNumber, JSON.stringify(sesion), new Date()]);
  } catch (error) {
    Logger.log('⚠️ Error guardando sesión: ' + error.toString());
  }
}

// ============================================
// LIMPIAR SESIÓN
// ============================================
function limpiarSesion(phoneNumber) {
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName(SESSION_SHEET_NAME);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === phoneNumber) {
        sheet.deleteRow(i + 1);
        return;
      }
    }
  } catch (error) {
    Logger.log('⚠️ Error limpiando sesión: ' + error.toString());
  }
}

// ============================================
// CREAR SESIÓN NUEVA (desde cero)
// ============================================
function crearSesionNueva() {
  return {
    audiencia: null,
    userData: null,
    nodoActual: null,
    ultimaActividad: Date.now()
  };
}

// ============================================
// VERIFICAR EXPIRACIÓN
// ============================================
function sesionExpirada(sesion) {
  if (!sesion.ultimaActividad) return true;
  return (Date.now() - sesion.ultimaActividad) / (1000 * 60 * 60) >= SESSION_EXPIRY_HOURS;
}

// ============================================
// COMANDO RESET
// ============================================
function esComandoReset(texto) {
  return texto === 'reset' || texto === 'reiniciar';
}

// ============================================
// LIMPIEZA DE SESIONES ANTIGUAS (ejecutar con trigger diario)
// ============================================
function limpiarSesionesAntiguas() {
  try {
    const ss = SpreadsheetApp.openById(getBotSheetId());
    const sheet = ss.getSheetByName(SESSION_SHEET_NAME);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    let eliminadas = 0;

    // Recorrer de abajo hacia arriba para no desplazar índices al borrar
    for (let i = data.length - 1; i >= 1; i--) {
      const ultimaActividad = data[i][2];
      if (!ultimaActividad) { sheet.deleteRow(i + 1); eliminadas++; continue; }

      const fecha = ultimaActividad instanceof Date ? ultimaActividad.getTime() : Date.parse(ultimaActividad);
      if (isNaN(fecha) || (Date.now() - fecha) / 3600000 >= 24) {
        sheet.deleteRow(i + 1);
        eliminadas++;
      }
    }
    Logger.log('🧹 Sesiones limpiadas: ' + eliminadas);
  } catch (error) {
    Logger.log('⚠️ Error limpiando sesiones: ' + error.toString());
  }
}
