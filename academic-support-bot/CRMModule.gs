// ============================================
// Cloud Academy Bot v2 - CRMModule.gs
// Conexión con el CRM (solo lectura)
// ============================================

// ============================================
// BUSCAR ALUMNO POR TELÉFONO
// ============================================
function buscarAlumnoPorTelefono(telefono) {
  try {
    const config = getConfig();
    const crmSheetId = config['CRM_SHEET_ID'];
    if (!crmSheetId) return null;

    const telefonoDigitos = String(telefono).replace(/[^\d]/g, '');
    const ss = SpreadsheetApp.openById(crmSheetId);
    const sheet = ss.getSheetByName('Alumnos');
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const telEnHoja = String(data[i][3] || '').replace(/[^\d]/g, '');
      if (telefonoDigitos.slice(-9) === telEnHoja.slice(-9) && telEnHoja.length >= 7) {
        const alumnoId = String(data[i][0] || '');
        const matriculas = obtenerMatriculasAlumno(alumnoId, ss);
        // Precargar sección solo si tiene exactamente una vigente (no finalizada)
        const vigentesAl = matriculas.filter(function(s) {
          return s.EstadoMatricula !== 'Retirado' && s.EstadoSeccion !== 'FINALIZADA';
        });
        const seccionData = vigentesAl.length === 1
          ? obtenerDatosSeccion(vigentesAl[0].Seccion, ss)
          : null;

        return {
          id: alumnoId,
          nombre: String(data[i][1] || ''),
          email: String(data[i][2] || ''),
          telefono: String(data[i][3] || ''),
          pais: String(data[i][4] || ''),
          matriculas: matriculas,
          seccionData: seccionData
        };
      }
    }
    return null;
  } catch (error) {
    Logger.log('❌ Error buscarAlumno: ' + error.toString());
    return null;
  }
}

// ============================================
// BUSCAR DOCENTE POR TELÉFONO
// ============================================
function buscarDocentePorTelefono(telefono) {
  try {
    const config = getConfig();
    const crmSheetId = config['CRM_SHEET_ID'];
    if (!crmSheetId) return null;

    const telefonoDigitos = String(telefono).replace(/[^\d]/g, '');
    const ss = SpreadsheetApp.openById(crmSheetId);
    const sheet = ss.getSheetByName('Docentes');
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const telEnHoja = String(data[i][3] || '').replace(/[^\d]/g, '');
      if (telefonoDigitos.slice(-9) === telEnHoja.slice(-9) && telEnHoja.length >= 7) {
        const docenteId = String(data[i][0] || '');
        // Cargar las secciones que dicta el docente (espejo del flujo del alumno).
        // Se guardan en 'matriculas' para reutilizar toda la maquinaria de
        // selección multi-curso (obtenerMatriculasActivas, preguntarCurso, etc.)
        const matriculas = obtenerSeccionesDocente(docenteId, ss);
        // Precargar sección solo si dicta exactamente una vigente (no finalizada)
        const vigentesDoc = matriculas.filter(function(s) { return s.EstadoSeccion !== 'FINALIZADA'; });
        const seccionData = vigentesDoc.length === 1
          ? obtenerDatosSeccion(vigentesDoc[0].Seccion, ss)
          : null;

        return {
          id: docenteId,
          nombre: String(data[i][1] || ''),
          email: String(data[i][2] || ''),
          telefono: String(data[i][3] || ''),
          pais: String(data[i][4] || ''),
          certificaciones: String(data[i][5] || ''),
          cursosQueDicta: String(data[i][6] || ''),
          matriculas: matriculas,
          seccionData: seccionData,
          rol: 'DOCENTE'
        };
      }
    }
    return null;
  } catch (error) {
    Logger.log('❌ Error buscarDocente: ' + error.toString());
    return null;
  }
}

// ============================================
// NORMALIZAR ESTADO DE UNA SECCIÓN (columna Estado del CRM, índice 12)
// El estado NO se calcula por fechas: se lee de la columna "Estado" de la hoja
// Secciones y se mapea a los tokens internos que usa el bot:
//   - "Programada"  → PROGRAMADA
//   - "En Curso"    → EN_PROGRESO
//   - "Finalizada"  → FINALIZADA
//   - "Cancelada"   → CANCELADA
// La comparación es tolerante a mayúsculas y acentos. Si el valor está vacío
// o no reconocido, se asume EN_PROGRESO (no ocultar por dato faltante).
// ============================================
function calcularEstadoSeccion(estadoRaw) {
  const normalizado = String(estadoRaw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quitar acentos

  if (normalizado === 'programada') return 'PROGRAMADA';
  if (normalizado === 'en curso' || normalizado === 'en progreso') return 'EN_PROGRESO';
  if (normalizado === 'finalizada' || normalizado === 'finalizado') return 'FINALIZADA';
  if (normalizado === 'cancelada' || normalizado === 'cancelado') return 'CANCELADA';
  return 'EN_PROGRESO';
}

// ============================================
// OBTENER SECCIONES QUE DICTA UN DOCENTE
// Recorre la hoja Secciones y devuelve todas donde el docente es titular.
// Formato compatible con las matrículas del alumno (usa .Seccion) para
// reutilizar el flujo de selección multi-curso. Incluye NombreCurso y EstadoSeccion.
// ============================================
function obtenerSeccionesDocente(docenteId, ss) {
  try {
    if (!docenteId) return [];
    const sheet = ss.getSheetByName('Secciones');
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const secciones = [];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5] || '').trim() !== String(docenteId).trim()) continue;
      secciones.push({
        Seccion: String(data[i][0] || ''),
        NombreCurso: String(data[i][1] || ''),
        Provider: String(data[i][3] || ''), // columna Provider (D) del CRM
        EstadoSeccion: calcularEstadoSeccion(data[i][12]), // columna Estado (M) del CRM
        EstadoMatricula: 'Activa' // marca fija para que pase el filtro de "activas"
      });
    }
    return secciones;
  } catch (error) {
    Logger.log('⚠️ Error secciones docente: ' + error.toString());
    return [];
  }
}

// ============================================
// OBTENER MATRÍCULAS DE UN ALUMNO
// ============================================
function obtenerMatriculasAlumno(alumnoId, ss) {
  try {
    const sheet = ss.getSheetByName('Matriculas');
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();

    // Mapa de secciones para enriquecer cada matrícula con NombreCurso y estado
    // (la matrícula solo guarda el código de sección, el resto vive en Secciones).
    const infoSecciones = mapaSecciones(ss);

    const matriculas = [];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').trim() !== String(alumnoId).trim()) continue;
      const esTest = String(data[i][11] || '').trim();
      if (esTest === 'Sí' || esTest === 'Si') continue;

      const codigoSeccion = String(data[i][2] || '').trim();
      const info = infoSecciones[codigoSeccion] || {};

      matriculas.push({
        ID: String(data[i][0] || ''),
        Seccion: codigoSeccion,
        NombreCurso: info.nombreCurso || '',
        Provider: info.provider || '',
        EstadoSeccion: info.estado || 'EN_PROGRESO',
        PrecioTotal: parseFloat(data[i][3]) || 0,
        EstadoPago: String(data[i][5] || ''),
        TotalPagado: parseFloat(data[i][6]) || 0,
        EstadoMatricula: String(data[i][7] || 'Activa'),
        SaldoPendiente: parseFloat(data[i][8]) || 0,
        Modalidad: String(data[i][14] || 'Pro'),
        MontoExamen: parseFloat(data[i][15]) || 0
      });
    }
    return matriculas;
  } catch (error) {
    Logger.log('⚠️ Error matrículas: ' + error.toString());
    return [];
  }
}

// ============================================
// MAPA DE SECCIONES: código -> { nombreCurso, estado }
// Lee la hoja Secciones una sola vez para enriquecer las matrículas del alumno.
// ============================================
function mapaSecciones(ss) {
  try {
    const sheet = ss.getSheetByName('Secciones');
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    const mapa = {};
    for (let i = 1; i < data.length; i++) {
      const codigo = String(data[i][0] || '').trim();
      if (!codigo) continue;
      mapa[codigo] = {
        nombreCurso: String(data[i][1] || ''),
        provider: String(data[i][3] || ''), // columna Provider (D) del CRM
        estado: calcularEstadoSeccion(data[i][12]) // columna Estado (M) del CRM
      };
    }
    return mapa;
  } catch (error) {
    Logger.log('⚠️ Error mapa secciones: ' + error.toString());
    return {};
  }
}

// ============================================
// OBTENER DATOS DE LA SECCIÓN (Meet, fechas, Drive, docente)
// ============================================
function obtenerDatosSeccion(codigoSeccion, ss) {
  try {
    const sheet = ss.getSheetByName('Secciones');
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();

    const codigoBuscado = String(codigoSeccion || '').trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() !== codigoBuscado) continue;

      const fechaRaw = data[i][13];
      let fechaInicio = '';
      if (fechaRaw instanceof Date) {
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        fechaInicio = fechaRaw.getDate() + ' de ' + meses[fechaRaw.getMonth()] + ', ' + fechaRaw.getFullYear();
      } else {
        fechaInicio = String(fechaRaw || '');
      }

      const driveFolderId = String(data[i][18] || '');
      const driveUrl = driveFolderId ? 'https://drive.google.com/drive/folders/' + driveFolderId : '';

      const calendarEventId = String(data[i][20] || '');
      let meetUrl = '';

      // Obtener Meet URL desde Calendar.
      // Los eventos de clase viven en el calendario académico compartido, no en el
      // 'primary' de quien ejecuta el script. El ID se configura en Script Properties
      // con la clave CALENDAR_ID (fallback a 'primary' si no está definido).
      if (calendarEventId) {
        try {
          const calendarId = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') || 'primary';
          const event = Calendar.Events.get(calendarId, calendarEventId);
          if (event.conferenceData && event.conferenceData.entryPoints) {
            for (let ep = 0; ep < event.conferenceData.entryPoints.length; ep++) {
              if (event.conferenceData.entryPoints[ep].entryPointType === 'video') {
                meetUrl = event.conferenceData.entryPoints[ep].uri || '';
                break;
              }
            }
          }
        } catch (calError) {
          Logger.log('⚠️ Error obteniendo Meet de Calendar: ' + calError.toString());
        }
      }

      return {
        codigo: String(data[i][0]),
        nombreCurso: String(data[i][1] || ''),
        frecuencia: String(data[i][10] || ''),
        fechaInicio: fechaInicio,
        fechaInicioRaw: (fechaRaw instanceof Date) ? fechaRaw : (data[i][13] || ''), // para fallback de fechas
        horasTotales: parseFloat(data[i][7]) || 0, // para fallback de fechas
        fechaFin: String(data[i][14] || ''),
        docenteNombre: String(data[i][6] || ''),
        docenteId: String(data[i][5] || ''),
        docenteLinkedIn: obtenerDatoDocente(String(data[i][5] || ''), 12, ss), // LinkedIn (col M/12)
        driveUrl: driveUrl,
        driveFolderId: driveFolderId,
        meetUrl: meetUrl,
        calendarEventId: calendarEventId,
        classroomId: String(data[i][21] || ''),
        classroomUrl: data[i][21] ? 'https://classroom.google.com/c/' + String(data[i][21]) : ''
      };
    }
    return null;
  } catch (error) {
    Logger.log('⚠️ Error sección: ' + error.toString());
    return null;
  }
}

// ============================================
// CALCULAR HONORARIOS DE UNA SECCIÓN (para docente)
// Replica la fórmula del CRM (calcularGastosDocentes): HorasTotales × TarifaHora.
//   - HorasTotales: hoja Secciones col 7 (índice 7)
//   - TarifaHora:   hoja Docentes col 7 (índice 7), buscada por DocenteID (Secciones col 5)
// Devuelve { horas, tarifa, total } o null si no encuentra datos.
// ============================================
function calcularHonorariosSeccion(codigoSeccion) {
  try {
    const config = getConfig();
    const crmSheetId = config['CRM_SHEET_ID'];
    if (!crmSheetId) return null;
    const ss = SpreadsheetApp.openById(crmSheetId);
    const secSheet = ss.getSheetByName('Secciones');
    if (!secSheet) return null;
    const secData = secSheet.getDataRange().getValues();

    let horas = 0;
    let docenteId = '';
    for (let i = 1; i < secData.length; i++) {
      if (String(secData[i][0] || '').trim() === String(codigoSeccion).trim()) {
        horas = parseFloat(secData[i][7]) || 0;   // HorasTotales (col 7)
        docenteId = String(secData[i][5] || '');   // DocenteID (col 5)
        break;
      }
    }
    if (!docenteId) return null;

    const tarifa = parseFloat(obtenerDatoDocente(docenteId, 7, ss)) || 0; // TarifaHora (col 7)
    return { horas: horas, tarifa: tarifa, total: horas * tarifa };
  } catch (error) {
    Logger.log('⚠️ Error honorarios: ' + error.toString());
    return null;
  }
}

// ============================================
// OBTENER UN DATO DEL DOCENTE por ID (índice de columna de la hoja Docentes)
// Layout Docentes: ID(0), Nombre(1), Email(2), Telefono(3), Pais(4),
// Certificaciones(5), CursosQueDicta(6), TarifaHora(7), ..., LinkedIn(12), ...
// Devuelve '' si no lo encuentra.
// ============================================
function obtenerDatoDocente(docenteId, colIndex, ss) {
  try {
    if (!docenteId) return '';
    const sheet = ss.getSheetByName('Docentes');
    if (!sheet) return '';
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === String(docenteId).trim()) {
        return String(data[i][colIndex] || '');
      }
    }
    return '';
  } catch (error) {
    Logger.log('⚠️ Error dato docente: ' + error.toString());
    return '';
  }
}

// ============================================
// OBTENER PRÓXIMA CLASE (próxima instancia del evento recurrente)
// El evento de la sección es recurrente; sus repeticiones son las clases.
// Devuelve { fecha, hora, meetUrl } de la próxima instancia futura, o null.
// ============================================
function obtenerProximaClase(calendarEventId, seccionData) {
  // 1) Fuente principal: próxima instancia real en Calendar (incluye Meet)
  try {
    if (calendarEventId) {
      const calendarId = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') || 'primary';
      const ahora = new Date();
      const limite = new Date(ahora.getTime() + 60 * 24 * 60 * 60 * 1000);
      const resp = Calendar.Events.instances(calendarId, calendarEventId, {
        timeMin: ahora.toISOString(),
        timeMax: limite.toISOString(),
        maxResults: 1,
        orderBy: 'startTime',
        singleEvents: true
      });

      if (resp.items && resp.items.length > 0) {
        const inst = resp.items[0];
        const inicioRaw = inst.start && (inst.start.dateTime || inst.start.date);
        if (inicioRaw) {
          const inicio = new Date(inicioRaw);
          const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
          const fecha = dias[inicio.getDay()] + ' ' + inicio.getDate() + ' de ' + meses[inicio.getMonth()];
          const hora = Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'hh:mm a');
          let meetUrl = '';
          if (inst.conferenceData && inst.conferenceData.entryPoints) {
            for (let ep = 0; ep < inst.conferenceData.entryPoints.length; ep++) {
              if (inst.conferenceData.entryPoints[ep].entryPointType === 'video') {
                meetUrl = inst.conferenceData.entryPoints[ep].uri || '';
                break;
              }
            }
          }
          return { fecha: fecha, hora: hora, meetUrl: meetUrl };
        }
      }
    }
  } catch (error) {
    Logger.log('⚠️ Error próxima clase (Calendar): ' + error.toString());
  }

  // 2) Fallback: calcular por frecuencia y tomar la primera clase futura
  //    (o la primera de todas si ninguna es futura). Sin meetUrl.
  if (seccionData && seccionData.fechaInicioRaw && seccionData.frecuencia) {
    const clases = obtenerTodasLasClases(null, seccionData); // fuerza el cálculo por frecuencia
    if (clases && clases.length > 0) {
      const futura = clases.find(function(c) { return !c.pasada; });
      const elegida = futura || clases[0];
      return { fecha: elegida.fecha, hora: elegida.hora, meetUrl: '' };
    }
  }

  return null;
}

// ============================================
// OBTENER TODAS LAS CLASES DE UNA SECCIÓN
// Lista TODAS las instancias (pasadas y futuras) del evento recurrente.
// Devuelve un array [{ fecha, hora, inicio(Date), pasada(bool) }] ordenado.
// Ventana: 6 meses atrás a 6 meses adelante (cubre cualquier sección).
// ============================================
function obtenerTodasLasClases(calendarEventId, seccionData) {
  const ahora = new Date();
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  // 1) Fuente principal: instancias reales del evento recurrente en Calendar
  try {
    if (calendarEventId) {
      const calendarId = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') || 'primary';
      const desde = new Date(ahora.getTime() - 180 * 24 * 60 * 60 * 1000);
      const hasta = new Date(ahora.getTime() + 180 * 24 * 60 * 60 * 1000);
      const resp = Calendar.Events.instances(calendarId, calendarEventId, {
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        maxResults: 100,
        orderBy: 'startTime',
        singleEvents: true
      });
      if (resp.items && resp.items.length > 0) {
        const salida = [];
        resp.items.forEach(function(inst) {
          if (inst.status === 'cancelled') return;
          const inicioRaw = inst.start && (inst.start.dateTime || inst.start.date);
          if (!inicioRaw) return;
          const inicio = new Date(inicioRaw);
          salida.push({
            inicio: inicio,
            fecha: dias[inicio.getDay()] + ' ' + inicio.getDate() + ' de ' + meses[inicio.getMonth()],
            hora: Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'hh:mm a'),
            pasada: inicio < ahora
          });
        });
        if (salida.length > 0) return salida;
      }
    }
  } catch (error) {
    Logger.log('⚠️ Error todas las clases (Calendar): ' + error.toString());
  }

  // 2) Fallback: calcular por FechaInicio + Frecuencia + HorasTotales (como el CRM)
  if (seccionData && seccionData.fechaInicioRaw && seccionData.frecuencia) {
    const sesiones = calcularClasesPorFrecuencia(seccionData.fechaInicioRaw, seccionData.frecuencia, seccionData.horasTotales);
    return sesiones.map(function(s) {
      return {
        inicio: s.fecha,
        fecha: dias[s.fecha.getDay()] + ' ' + s.fecha.getDate() + ' de ' + meses[s.fecha.getMonth()],
        hora: formatearHora12(s.horaInicio, s.minInicio),
        pasada: s.fecha < ahora
      };
    });
  }

  return [];
}

// Formatea hora 24h -> "hh:mm AM/PM"
function formatearHora12(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  const mm = (m < 10 ? '0' : '') + m;
  const hh = (h12 < 10 ? '0' : '') + h12;
  return hh + ':' + mm + ' ' + ampm;
}

// ============================================
// FALLBACK: calcular fechas/horas de las clases a partir de FechaInicio,
// Frecuencia y HorasTotales. Réplica de calcularSesiones() del CRM.
// Patrones: L-M-V (19:00, 3h), M-J-S (L-J 19:00 3h, Sáb 10:00 3h),
//           Solo-Sabados / Sólo sábados (14:00, 5h).
// Devuelve [{ fecha(Date), horaInicio, minInicio, duracion }].
// ============================================
function calcularClasesPorFrecuencia(fechaInicio, frecuencia, horasTotales) {
  const sesiones = [];
  const fecha = new Date(fechaInicio);
  if (isNaN(fecha.getTime())) return sesiones;
  let horasRestantes = parseFloat(horasTotales) || 0;
  if (horasRestantes <= 0) return sesiones;

  let config = {};
  if (frecuencia === 'L-M-V') {
    config.horarios = { 1: {h:19,m:0,dur:3}, 3: {h:19,m:0,dur:3}, 5: {h:19,m:0,dur:3} };
  } else if (frecuencia === 'M-J-S') {
    config.horarios = { 2: {h:19,m:0,dur:3}, 4: {h:19,m:0,dur:3}, 6: {h:10,m:0,dur:3} };
  } else if (frecuencia === 'Solo-Sabados' || frecuencia === 'Sólo sábados') {
    config.horarios = { 6: {h:14,m:0,dur:5} };
  } else {
    return sesiones; // frecuencia no reconocida
  }

  // Primera clase: exactamente en fechaInicio (si ese día es válido)
  const horarioIni = config.horarios[fecha.getDay()];
  if (horarioIni) {
    const dur = Math.min(horarioIni.dur, horasRestantes);
    sesiones.push({ fecha: new Date(fecha), horaInicio: horarioIni.h, minInicio: horarioIni.m, duracion: dur });
    horasRestantes -= dur;
  }

  fecha.setDate(fecha.getDate() + 1);
  let iter = 0;
  while (horasRestantes > 0 && iter < 365) {
    const hor = config.horarios[fecha.getDay()];
    if (hor) {
      const dur = Math.min(hor.dur, horasRestantes);
      sesiones.push({ fecha: new Date(fecha), horaInicio: hor.h, minInicio: hor.m, duracion: dur });
      horasRestantes -= dur;
    }
    fecha.setDate(fecha.getDate() + 1);
    iter++;
  }
  return sesiones;
}

// ============================================
// OBTENER FECHA DE LA ÚLTIMA CLASE (para constancia)
// Devuelve un objeto Date con el inicio de la última clase, o null.
// Usa Calendar y, si no hay, el fallback por frecuencia.
// ============================================
function obtenerFechaUltimaClase(calendarEventId, seccionData) {
  const clases = obtenerTodasLasClases(calendarEventId, seccionData);
  if (!clases.length) return null;
  return clases[clases.length - 1].inicio;
}
