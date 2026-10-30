// ============================================
// Cloud Academy Academic Bot v2 - Code.gs
// Webhook principal - Flujo por menú (sin IA)
// ============================================

/**
 * Obtiene el BOT_SHEET_ID desde Script Properties.
 * Se configura en: Apps Script → Configuración del proyecto → Propiedades del script
 */
function getBotSheetId() {
  return PropertiesService.getScriptProperties().getProperty('BOT_SHEET_ID') || '';
}

// ============================================
// WEBHOOK - Verificación de Meta (GET)
// ============================================
function doGet(e) {
  try {
    const config = getConfig();
    const verifyToken = config['WHATSAPP_VERIFY_TOKEN'] || '';
    const mode = e.parameter['hub.mode'];
    const token = e.parameter['hub.verify_token'];
    const challenge = e.parameter['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
      return ContentService.createTextOutput(challenge);
    }
    return ContentService.createTextOutput('Verification failed');
  } catch (error) {
    Logger.log('❌ Error en doGet: ' + error.toString());
    return ContentService.createTextOutput('Error');
  }
}

// ============================================
// WEBHOOK - Recepción de mensajes (POST)
// ============================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (!body.entry || !body.entry[0].changes) return okResponse();
    const change = body.entry[0].changes[0];
    if (change.field !== 'messages') return okResponse();
    const value = change.value;
    if (!value.messages || value.messages.length === 0) return okResponse();

    const message = value.messages[0];
    const phoneNumber = message.from;
    const messageType = message.type;

    // Deduplicación: Meta reenvía el webhook si no recibe el 200 OK a tiempo.
    // Cada mensaje tiene un id único; si ya lo procesamos, lo ignoramos.
    if (message.id && mensajeYaProcesado(message.id)) {
      Logger.log('↩️ Mensaje duplicado ignorado: ' + message.id);
      return okResponse();
    }

    // Botones interactivos
    if (messageType === 'interactive') {
      let buttonId = '';
      if (message.interactive.type === 'button_reply') {
        buttonId = message.interactive.button_reply.id;
      } else if (message.interactive.type === 'list_reply') {
        buttonId = message.interactive.list_reply.id;
      }
      Logger.log('🔘 Botón: ' + buttonId + ' de ' + phoneNumber);
      procesarInteraccion(phoneNumber, buttonId);
      return okResponse();
    }

    // Solo texto
    if (messageType === 'text') {
      const texto = message.text.body.trim();
      Logger.log('💬 ' + phoneNumber + ': ' + texto);
      procesarInteraccion(phoneNumber, texto);
      return okResponse();
    }

    // Otro tipo de mensaje
    enviarMensajeTexto(phoneNumber, getConfig()['MENSAJE_NO_ENTENDIDO'] || 'Solo puedo procesar mensajes de texto.');
    return okResponse();

  } catch (error) {
    Logger.log('❌ Error en doPost: ' + error.toString());
    return okResponse();
  }
}

function okResponse() {
  return ContentService.createTextOutput('OK');
}

// ============================================
// DEDUPLICACIÓN DE MENSAJES
// Guarda el id del mensaje en CacheService por 10 min. Si el mismo id
// vuelve a llegar (reenvío de Meta), devuelve true para ignorarlo.
// ============================================
function mensajeYaProcesado(messageId) {
  try {
    const cache = CacheService.getScriptCache();
    const clave = 'msg_' + messageId;
    if (cache.get(clave)) return true;
    cache.put(clave, '1', 600); // 10 minutos
    return false;
  } catch (error) {
    Logger.log('⚠️ Error dedup: ' + error.toString());
    return false; // ante error, no bloquear el mensaje
  }
}

// ============================================
// PROCESAMIENTO PRINCIPAL
// ============================================
function procesarInteraccion(phoneNumber, input) {
  try {
    const config = getConfig();
    const sesion = obtenerSesion(phoneNumber);
    const inputLower = input.toLowerCase().trim();

    // Debug (solo números autorizados)
    if (inputLower === 'debug') {
      const numerosDebug = (config['DEBUG_NUMEROS'] || '').split(',').map(function(n) { return n.trim(); });
      if (numerosDebug.indexOf(phoneNumber) === -1) {
        enviarMensajeTexto(phoneNumber, '⚠️ Opción no válida.');
        return;
      }
      const info = '🔧 DEBUG\nNúmero: ' + phoneNumber +
        '\nAudiencia: ' + (sesion.audiencia || 'ninguna') +
        '\nUsuario: ' + (sesion.userData ? sesion.userData.nombre : 'ninguno') +
        '\nNodo actual: ' + (sesion.nodoActual || 'ninguno') +
        '\nNodos en MENU: ' + getMenu().length;
      enviarMensajeTexto(phoneNumber, info);
      return;
    }

    // Reset
    if (esComandoReset(inputLower)) {
      limpiarSesion(phoneNumber);
      enviarBienvenida(phoneNumber, config);
      return;
    }

    // PASO 1: Sin audiencia → preguntar rol
    if (!sesion.audiencia) {
      if (esRespuestaAlumno(inputLower)) {
        sesion.audiencia = 'ALUMNO';
        guardarSesion(phoneNumber, sesion);
        identificarUsuario(phoneNumber, sesion, config);
      } else if (esRespuestaDocente(inputLower)) {
        sesion.audiencia = 'DOCENTE';
        guardarSesion(phoneNumber, sesion);
        identificarUsuario(phoneNumber, sesion, config);
      } else {
        enviarBienvenida(phoneNumber, config);
      }
      return;
    }

    // PASO 2: Sin datos del CRM → identificar
    if (!sesion.userData) {
      identificarUsuario(phoneNumber, sesion, config);
      return;
    }

    // PASO 3: Navegar el menú
    navegarMenu(phoneNumber, input, sesion, config);

  } catch (error) {
    Logger.log('❌ Error en procesarInteraccion: ' + error.toString());
    enviarMensajeTexto(phoneNumber, getConfig()['MENSAJE_DERIVAR']);
  }
}

// ============================================
// REFRESCAR DATOS DEL USUARIO DESDE EL CRM
// Vuelve a leer del CRM para evitar datos obsoletos en la sesión (matrículas,
// secciones, saldos). Conserva el estado de navegación. Si el CRM no responde,
// mantiene los datos que ya había en sesión.
// ============================================
function refrescarUserData(phoneNumber, sesion) {
  try {
    let fresco = null;
    if (sesion.audiencia === 'ALUMNO') {
      fresco = buscarAlumnoPorTelefono(phoneNumber);
    } else if (sesion.audiencia === 'DOCENTE') {
      fresco = buscarDocentePorTelefono(phoneNumber);
    }
    if (fresco) {
      // Conservar la seccionData ya seleccionada si existe
      const seccionData = sesion.userData ? sesion.userData.seccionData : null;
      sesion.userData = fresco;
      if (seccionData) sesion.userData.seccionData = seccionData;
      guardarSesion(phoneNumber, sesion);
    }
  } catch (error) {
    Logger.log('⚠️ Error refrescando userData: ' + error.toString());
  }
}

// ============================================
// IDENTIFICAR USUARIO EN CRM
// ============================================
function identificarUsuario(phoneNumber, sesion, config) {
  let userData = null;

  if (sesion.audiencia === 'ALUMNO') {
    userData = buscarAlumnoPorTelefono(phoneNumber);
  } else {
    userData = buscarDocentePorTelefono(phoneNumber);
  }

  if (!userData) {
    enviarMensajeTexto(phoneNumber, config['MENSAJE_NO_REGISTRADO']);
    notificarAcademico(phoneNumber, 'No registrado (' + sesion.audiencia + ')', '', config['EMAIL_ACADEMICO']);
    limpiarSesion(phoneNumber);
    registrarLog(phoneNumber, '', 'NO_REGISTRADO', true, 0, sesion);
    return;
  }

  sesion.userData = userData;
  sesion.nodoActual = null;
  guardarSesion(phoneNumber, sesion);

  // Saludar y mostrar menú principal en un solo mensaje
  const primerNombre = userData.nombre.split(' ')[0];
  sesion.nodoActual = sesion.audiencia === 'ALUMNO' ? 'ALUMNO_ROOT' : 'DOCENTE_ROOT';
  guardarSesion(phoneNumber, sesion);

  // Mostrar saludo + menú como texto numerado
  mostrarHijosConSaludo(phoneNumber, sesion.nodoActual, sesion, primerNombre);
}

// ============================================
// MOSTRAR MENÚ PRINCIPAL (nivel 1)
// ============================================
function mostrarMenuPrincipal(phoneNumber, sesion) {
  const rootId = sesion.audiencia === 'ALUMNO' ? 'ALUMNO_ROOT' : 'DOCENTE_ROOT';
  sesion.nodoActual = rootId;
  guardarSesion(phoneNumber, sesion);
  mostrarHijos(phoneNumber, rootId, sesion);
}

// ============================================
// MOSTRAR HIJOS CON SALUDO (para primera vez)
// ============================================
function mostrarHijosConSaludo(phoneNumber, padreId, sesion, primerNombre) {
  const menu = getMenu();
  const hijos = menu.filter(function(n) {
    return n.PADRE === padreId && n.ACTIVO === 'SI';
  }).sort(function(a, b) {
    return (parseInt(a.ORDEN) || 99) - (parseInt(b.ORDEN) || 99);
  });

  sesion.opcionesActuales = hijos.map(function(h) { return h.ID; });
  guardarSesion(phoneNumber, sesion);

  let texto = '👋 Hola *' + primerNombre + '*! ¿En qué puedo ayudarte?\n';
  const emojis = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.'];
  hijos.forEach(function(h, i) {
    texto += '\n' + emojis[i] + ' ' + h.TITULO_OPCION;
  });
  const config = getConfig(); texto += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número de tu opción.') + '_';
  enviarMensajeTexto(phoneNumber, texto);
}

// ============================================
// NAVEGAR EL MENÚ
// ============================================
function navegarMenu(phoneNumber, input, sesion, config) {
  const inputUpper = input.toUpperCase().trim();
  const inputLower = input.toLowerCase().trim();

  // Si estamos esperando la descripción del problema (post-DERIVAR)
  if (sesion.esperandoDescripcion) {
    const mensajeConfirmacion = config['MENSAJE_DERIVACION_CONFIRMADA'] || '✅ Recibimos tu mensaje. Un asesor se comunicará contigo en un máximo de 48 horas hábiles.';
    enviarMensajeTexto(phoneNumber, mensajeConfirmacion);
    notificarAcademico(phoneNumber, sesion.userData.nombre, 'Menú: ' + (sesion.nodoDerivacion || 'DERIVAR') + '\nMensaje del alumno: ' + input, config['EMAIL_ACADEMICO']);
    delete sesion.esperandoDescripcion;
    delete sesion.nodoDerivacion;
    guardarSesion(phoneNumber, sesion);
    Utilities.sleep(500);
    enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');
    registrarLog(phoneNumber, input, 'DERIVAR_DESCRIPCION', true, 0, sesion);
    return;
  }

  // Flujo de CAMBIO DE DATOS (correo/celular). Se procesa antes de la lógica de
  // menú porque captura texto libre en varios pasos. "0"/"menu" cancelan el flujo.
  if (sesion.flujoCambioDatos) {
    if (inputLower === '0' || inputLower === 'menu' || inputLower === 'menú' || inputLower === 'volver' || inputLower === 'cancelar') {
      delete sesion.flujoCambioDatos;
      guardarSesion(phoneNumber, sesion);
      enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_CANCELADO'] || '❎ Cambio cancelado.');
      mostrarMenuPrincipal(phoneNumber, sesion);
      return;
    }
    procesarFlujoCambioDatos(phoneNumber, input, sesion, config);
    return;
  }

  // "Volver" → subir un nivel
  if (inputLower === 'volver' || inputLower === '0' || inputUpper === 'MENU_VOLVER') {
    // Tras ver honorarios, "0" vuelve al paso anterior:
    //  - si había lista de secciones (varias) → re-muestra la lista;
    //  - si fue directo (una sola sección) → menú principal.
    if (sesion.honorarioConsultado) {
      const vinoDeLista = sesion.honorarioDesdeLista;
      delete sesion.honorarioConsultado;
      delete sesion.honorarioDesdeLista;
      delete sesion.ultimaFueAccion;
      guardarSesion(phoneNumber, sesion);
      if (vinoDeLista) {
        iniciarFlujoHonorarios(phoneNumber, sesion, config);
      } else {
        mostrarMenuPrincipal(phoneNumber, sesion);
      }
      return;
    }
    // Tras ver constancia, "0" vuelve al paso anterior:
    //  - si había lista de secciones (varias) → re-muestra la lista;
    //  - si fue directa (una sola sección) → al submenú de Trámites.
    if (sesion.constanciaConsultada) {
      const constDeLista = sesion.constanciaDesdeLista;
      delete sesion.constanciaConsultada;
      delete sesion.constanciaDesdeLista;
      delete sesion.ultimaFueAccion;
      guardarSesion(phoneNumber, sesion);
      if (constDeLista) {
        iniciarFlujoConstancia(phoneNumber, sesion, config);
      } else {
        sesion.nodoActual = 'A_TRAMITES';
        guardarSesion(phoneNumber, sesion);
        mostrarHijos(phoneNumber, 'A_TRAMITES', sesion);
      }
      return;
    }
    // Si lo último mostrado fue una acción hoja (enlace, texto, etc.), "0" debe
    // regresar al MISMO submenú donde estaba el usuario (no subir un nivel).
    if (sesion.ultimaFueAccion) {
      delete sesion.ultimaFueAccion;
      guardarSesion(phoneNumber, sesion);
      mostrarHijos(phoneNumber, sesion.nodoActual, sesion);
      return;
    }
    // Si estamos eligiendo sección, "0" vuelve al menú principal
    // (ya no existe un paso previo de curso).
    if (sesion.seleccionandoCurso) {
      delete sesion.seleccionandoCurso;
      mostrarMenuPrincipal(phoneNumber, sesion);
      return;
    }
    // Si estamos en el submenú del curso (A_CURSO/D_CLASE), "0" regresa al paso
    // de elegir sección (no al menú principal), reiniciando esa selección.
    if (sesion.nodoActual === 'A_CURSO' || sesion.nodoActual === 'D_CLASE') {
      delete sesion.seccionSeleccionada;
      guardarSesion(phoneNumber, sesion);
      iniciarSeleccionCurso(phoneNumber, sesion);
      return;
    }
    const nodoActual = obtenerNodoPorId(sesion.nodoActual);
    if (nodoActual && nodoActual.PADRE) {
      sesion.nodoActual = nodoActual.PADRE;
      // Limpiar sección seleccionada al volver
      if (nodoActual.PADRE === 'ALUMNO_ROOT' || nodoActual.PADRE === 'DOCENTE_ROOT') {
        delete sesion.seccionSeleccionada;
      }
      guardarSesion(phoneNumber, sesion);
      mostrarHijos(phoneNumber, nodoActual.PADRE, sesion);
    } else {
      mostrarMenuPrincipal(phoneNumber, sesion);
    }
    return;
  }

  // "Menu" o "9" → ir al menú principal.
  // El atajo "9 = menú principal" no aplica cuando el 9 puede ser una opción real:
  //   - mientras se elige sección/honorarios (lista dinámica), o
  //   - cuando el submenú actual tiene 9 o más opciones (el 9 elige la opción).
  // En esos casos se usa "0" para volver.
  const es9 = input.trim() === '9';
  const eligiendoLista = sesion.seleccionandoCurso || sesion.seleccionandoHonorarios || sesion.seleccionandoConstancia;
  const menuTiene9 = sesion.opcionesActuales && sesion.opcionesActuales.length >= 9;
  const nueveEsOpcion = eligiendoLista || menuTiene9;
  if (inputLower === 'menu' || inputLower === 'menú' || inputUpper === 'MENU_PRINCIPAL' || (es9 && !nueveEsOpcion)) {
    delete sesion.ultimaFueAccion;
    delete sesion.seleccionandoCurso;
    delete sesion.seleccionandoHonorarios;
    delete sesion.seleccionandoConstancia;
    delete sesion.honorarioConsultado;
    delete sesion.honorarioDesdeLista;
    delete sesion.constanciaConsultada;
    delete sesion.constanciaDesdeLista;
    delete sesion.seccionSeleccionada;
    mostrarMenuPrincipal(phoneNumber, sesion);
    return;
  }

  // Elegir SECCIÓN (lista agrupada por curso)
  if (sesion.seleccionandoCurso) {
    const numero = parseInt(input);
    if (!isNaN(numero) && numero >= 1 && sesion.opcionesCursos && numero <= sesion.opcionesCursos.length) {
      cargarSeccionYMostrar(phoneNumber, sesion, sesion.opcionesCursos[numero - 1]);
      return;
    }
    enviarMensajeTexto(phoneNumber, config['MENSAJE_OPCION_INVALIDA_SECCION'] || '⚠️ Opción no válida. Ingresa el número de la sección.');
    return;
  }

  // Elegir sección para ver HONORARIOS (docente)
  if (sesion.seleccionandoHonorarios) {
    const numero = parseInt(input);
    if (!isNaN(numero) && numero >= 1 && sesion.opcionesHonorarios && numero <= sesion.opcionesHonorarios.length) {
      mostrarHonorariosSeccion(phoneNumber, sesion, sesion.opcionesHonorarios[numero - 1], config, true);
      return;
    }
    enviarMensajeTexto(phoneNumber, config['MENSAJE_OPCION_INVALIDA_SECCION'] || '⚠️ Opción no válida. Ingresa el número de la sección.');
    return;
  }

  // Elegir sección para la CONSTANCIA (alumno, desde Trámites)
  if (sesion.seleccionandoConstancia) {
    const numero = parseInt(input);
    if (!isNaN(numero) && numero >= 1 && sesion.opcionesConstancia && numero <= sesion.opcionesConstancia.length) {
      mostrarConstanciaSeccion(phoneNumber, sesion, sesion.opcionesConstancia[numero - 1], config, true);
      return;
    }
    enviarMensajeTexto(phoneNumber, config['MENSAJE_OPCION_INVALIDA_SECCION'] || '⚠️ Opción no válida. Ingresa el número de la sección.');
    return;
  }

  // Resolver por número (1, 2, 3...)
  const numero = parseInt(input);
  if (!isNaN(numero) && numero >= 1 && sesion.opcionesActuales && numero <= sesion.opcionesActuales.length) {
    const nodoId = sesion.opcionesActuales[numero - 1];
    const nodo = obtenerNodoPorId(nodoId);
    if (nodo) {
      // Si elige "Mi Curso" (alumno) o "Mi Clase" (docente), iniciar el flujo de
      // dos pasos: primero elegir CURSO, luego la SECCIÓN clasificada por estado.
      if (nodoId === 'A_CURSO' || nodoId === 'D_CLASE') {
        iniciarSeleccionCurso(phoneNumber, sesion);
        return;
      }

      if (nodo.TIPO_NODO === 'MENU') {
        sesion.nodoActual = nodo.ID;
        guardarSesion(phoneNumber, sesion);
        mostrarHijos(phoneNumber, nodo.ID, sesion);
      } else if (nodo.TIPO_NODO === 'ACCION') {
        ejecutarAccion(phoneNumber, nodo, sesion, config);
      }
      return;
    }
  }

  // Resolver por ID directo (de botones interactivos si se usan)
  const nodo = obtenerNodoPorId(inputUpper);
  if (nodo) {
    // Validar que el nodo pertenezca a la audiencia del usuario
    if (nodo.AUDIENCIA && nodo.AUDIENCIA !== sesion.audiencia) {
      enviarMensajeTexto(phoneNumber, config['MENSAJE_OPCION_INVALIDA'] || '⚠️ Opción no válida. Ingresa un número del menú o escribe *0* para volver.');
      return;
    }
    if (nodo.TIPO_NODO === 'MENU') {
      sesion.nodoActual = nodo.ID;
      guardarSesion(phoneNumber, sesion);
      mostrarHijos(phoneNumber, nodo.ID, sesion);
    } else if (nodo.TIPO_NODO === 'ACCION') {
      ejecutarAccion(phoneNumber, nodo, sesion, config);
    }
    return;
  }

  // No reconocido
  enviarMensajeTexto(phoneNumber, config['MENSAJE_OPCION_INVALIDA'] || '⚠️ Opción no válida. Ingresa un número del menú o escribe *0* para volver.');
  mostrarHijos(phoneNumber, sesion.nodoActual, sesion);
}

// ============================================
// INICIAR SELECCIÓN CURSO → SECCIÓN (flujo de dos pasos)
// Muestra las secciones vigentes (programadas + en progreso). Agrupa por curso:
//   - Si hay varios cursos: pregunta primero el curso (paso 1).
//   - Si hay un solo curso con varias secciones: pregunta la sección (paso 2).
//   - Si hay una sola sección: la carga directo.
// ============================================
function iniciarSeleccionCurso(phoneNumber, sesion) {
  // Refrescar datos del CRM para no trabajar con info cacheada obsoleta
  // (nuevas secciones, cambios de estado, saldos actualizados).
  refrescarUserData(phoneNumber, sesion);

  // Las canceladas nunca se ofrecen (a ningún rol): no son consultables.
  const activas = obtenerMatriculasActivas(sesion).filter(function(s) {
    return s.EstadoSeccion !== 'CANCELADA';
  });

  // Alumno: mostrar TODAS las secciones (incluidas finalizadas, etiquetadas), para
  // que pueda consultar material/grabaciones de cursos pasados.
  // Docente: solo secciones vigentes (no consulta clases ya dictadas).
  let lista;
  if (sesion.audiencia === 'DOCENTE') {
    lista = activas.filter(function(s) { return s.EstadoSeccion !== 'FINALIZADA'; });
    if (lista.length === 0) lista = activas; // fallback si no hay vigentes
  } else {
    lista = activas;
  }

  // Deduplicar por código de sección: si el CRM trae la misma sección más de una
  // vez (matrícula duplicada o fila repetida en Secciones), se muestra una sola vez.
  lista = dedupSecciones(lista);

  if (lista.length === 0) {
    enviarMensajeTexto(phoneNumber, 'No tienes cursos registrados. Escribe *0* para volver.');
    return;
  }

  // Una sola sección → cargar directo
  if (lista.length === 1) {
    cargarSeccionYMostrar(phoneNumber, sesion, lista[0]);
    return;
  }

  // Ya no se pregunta el curso: se muestran directamente las secciones,
  // agrupadas por curso y con su estado al lado.
  preguntarSeccion(phoneNumber, sesion, lista);
}

// ============================================
// ENCABEZADO DE SECCIÓN (en negrita, arriba de cada respuesta)
// Devuelve '' si no hay sección seleccionada. Usa plantilla editable
// MSG_ENCABEZADO_SECCION con variables {curso} y {seccion}.
// ============================================
function encabezadoSeccion(sesion) {
  const sec = sesion && sesion.seccionSeleccionada;
  if (!sec) return '';
  const config = getConfig();
  const curso = sec.NombreCurso || (sesion.userData && sesion.userData.seccionData ? sesion.userData.seccionData.nombreCurso : '') || '';
  const codigo = sec.Seccion || '';
  let plantilla = config['MSG_ENCABEZADO_SECCION'] || '*{curso} ({seccion})*';
  plantilla = plantilla.replace(/\{curso\}/gi, curso).replace(/\{seccion\}/gi, codigo);
  return plantilla + '\n\n';
}

// ============================================
// CONSTANCIA (alumno, desde Trámites) — flujo
// Si el alumno tiene una sola sección, calcula directo; si tiene varias,
// pregunta de cuál sección quiere la constancia y luego la muestra.
// ============================================
function iniciarFlujoConstancia(phoneNumber, sesion, config) {
  refrescarUserData(phoneNumber, sesion);
  const activas = obtenerMatriculasActivas(sesion).filter(function(s) {
    return s.EstadoSeccion !== 'CANCELADA';
  });

  if (activas.length === 0) {
    enviarMensajeTexto(phoneNumber, config['MSG_CONSTANCIA_SIN_SECCIONES'] || 'ℹ️ No tienes cursos registrados para emitir constancia. Escribe *0* para volver.');
    return;
  }
  if (activas.length === 1) {
    mostrarConstanciaSeccion(phoneNumber, sesion, activas[0], config, false);
    return;
  }

  // Varias secciones → preguntar
  sesion.seleccionandoConstancia = true;
  sesion.opcionesConstancia = activas;
  guardarSesion(phoneNumber, sesion);

  let texto = (config['MSG_CONSTANCIA_ELEGIR'] || '📜 ¿De qué curso quieres tu constancia?') + '\n';
  const emojis = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'];
  activas.forEach(function(s, i) {
    const nombre = s.NombreCurso ? (s.NombreCurso + ' (' + s.Seccion + ')') : s.Seccion;
    texto += '\n' + emojis[i] + ' ' + nombre + ' — ' + etiquetaEstadoSeccion(s.EstadoSeccion);
  });
  texto += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número.') + '_';
  texto += '\n_' + (config['MENSAJE_VOLVER_MENU'] || 'Escribe *0* para volver.').replace(/^_|_$/g, '') + '_';
  enviarMensajeTexto(phoneNumber, texto);
}

function mostrarConstanciaSeccion(phoneNumber, sesion, seccion, config, desdeLista) {
  delete sesion.seleccionandoConstancia;
  delete sesion.opcionesConstancia;

  // Cargar la seccionData de esa sección (para que el cálculo de constancia use su Calendar)
  const crmConfig = getConfig();
  const ss = SpreadsheetApp.openById(crmConfig['CRM_SHEET_ID']);
  const seccionData = obtenerDatosSeccion(seccion.Seccion, ss);
  if (seccionData) sesion.userData.seccionData = seccionData;

  const datos = obtenerDatosCRM('constancia', sesion.userData, config);
  // Encabezado con el curso/código de la sección elegida (sin usar seccionSeleccionada,
  // para no contaminar otras pantallas de Trámites).
  const nombreCurso = seccion.NombreCurso || (seccionData ? seccionData.nombreCurso : '') || '';
  let encab = (config['MSG_ENCABEZADO_SECCION'] || '*{curso} ({seccion})*')
    .replace(/\{curso\}/gi, nombreCurso)
    .replace(/\{seccion\}/gi, seccion.Seccion || '') + '\n\n';

  if (datos && datos.texto) {
    enviarMensajeTexto(phoneNumber, encab + datos.texto);
  } else {
    enviarMensajeTexto(phoneNumber, encab + (config['MSG_CONSTANCIA_NO_FIN'] || 'ℹ️ Tu constancia se enviará una vez finalizado el curso. Escribe *0* para volver.'));
  }
  // Recordar que se mostró constancia y si venía de una lista, para que "0"
  // regrese a la lista de secciones o al menú según corresponda.
  sesion.constanciaConsultada = true;
  sesion.constanciaDesdeLista = !!desdeLista;
  guardarSesion(phoneNumber, sesion);
  Utilities.sleep(400);
  enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *9* para el menú principal._');
}

// ============================================
// HONORARIOS (docente) — flujo
// Muestra SOLO la última sección finalizada + la sección en curso (si existe).
// ============================================
function iniciarFlujoHonorarios(phoneNumber, sesion, config) {
  refrescarUserData(phoneNumber, sesion);
  const todas = (sesion.userData && sesion.userData.matriculas) || [];

  // En curso (puede haber varias; se toman todas las EN_PROGRESO)
  const enCurso = todas.filter(function(s) { return s.EstadoSeccion === 'EN_PROGRESO'; });

  // Última finalizada: ordenar finalizadas por recencia (mes/año del código) y tomar 1
  const finalizadas = todas.filter(function(s) { return s.EstadoSeccion === 'FINALIZADA'; });
  finalizadas.sort(function(a, b) { return pesoRecenciaSeccion(b) - pesoRecenciaSeccion(a); });
  const ultimaFin = finalizadas.length ? [finalizadas[0]] : [];

  // Lista final: en curso + última finalizada (sin duplicar)
  const lista = enCurso.concat(ultimaFin);

  if (lista.length === 0) {
    enviarMensajeTexto(phoneNumber, config['MSG_HONORARIOS_SIN_SECCIONES'] || 'ℹ️ No tienes secciones con honorarios para mostrar. Escribe *0* para volver.');
    return;
  }
  if (lista.length === 1) {
    mostrarHonorariosSeccion(phoneNumber, sesion, lista[0], config, false);
    return;
  }

  // Varias → elegir
  sesion.seleccionandoHonorarios = true;
  sesion.opcionesHonorarios = lista;
  guardarSesion(phoneNumber, sesion);

  let texto = (config['MSG_HONORARIOS_ELEGIR'] || '💰 ¿De qué sección quieres ver tus honorarios?') + '\n';
  const emojis = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'];
  lista.forEach(function(s, i) {
    const nombre = s.NombreCurso ? (s.NombreCurso + ' (' + s.Seccion + ')') : s.Seccion;
    texto += '\n' + emojis[i] + ' ' + nombre + ' — ' + etiquetaEstadoSeccion(s.EstadoSeccion);
  });
  texto += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número.') + '_';
  texto += '\n_' + (config['MENSAJE_VOLVER_MENU'] || 'Escribe *0* para volver o *9* para el menú principal.').replace(/^_|_$/g, '') + '_';
  enviarMensajeTexto(phoneNumber, texto);
}

function mostrarHonorariosSeccion(phoneNumber, sesion, seccion, config, desdeLista) {
  delete sesion.seleccionandoHonorarios;
  delete sesion.opcionesHonorarios;
  // Marcar que se consultó honorarios y si venía de una lista (para que "0"
  // regrese a la lista de secciones o al menú según corresponda).
  sesion.honorarioConsultado = seccion;
  sesion.honorarioDesdeLista = !!desdeLista;
  guardarSesion(phoneNumber, sesion);

  const h = calcularHonorariosSeccion(seccion.Seccion);
  if (!h) {
    enviarMensajeTexto(phoneNumber, config['MSG_HONORARIOS_NO_DATOS'] || 'ℹ️ No pude calcular los honorarios de esa sección. Escribe *0* para volver.');
  } else {
    const nombre = seccion.NombreCurso ? (seccion.NombreCurso + ' (' + seccion.Seccion + ')') : seccion.Seccion;
    let plantilla = config['MSG_HONORARIOS'] || '💰 Honorarios de *{seccion}*:\n{horas} h × ${tarifa} = *${total}*';
    plantilla = plantilla
      .replace(/\{seccion\}/gi, nombre)
      .replace(/\{horas\}/gi, h.horas)
      .replace(/\{tarifa\}/gi, h.tarifa.toFixed(2))
      .replace(/\{total\}/gi, h.total.toFixed(2));
    enviarMensajeTexto(phoneNumber, plantilla);
  }
  Utilities.sleep(400);
  enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *9* para el menú principal._');
}

// Peso de recencia por código de sección (mes/año embebido, ej. SAA0526-A → 2605).
// Mayor = más reciente. Si no matchea, devuelve 0.
function pesoRecenciaSeccion(s) {
  const m = String(s.Seccion || '').match(/(\d{2})(\d{2})-/);
  if (!m) return 0;
  const mes = parseInt(m[1], 10);
  const anio = parseInt(m[2], 10);
  return anio * 100 + mes; // año domina, luego mes
}

// Etiqueta de estado legible para mostrar junto a un curso/sección.
// Finalizada usa check gris (no verde); en curso verde; programada calendario.
function etiquetaEstadoSeccion(estado) {
  if (estado === 'FINALIZADA') return '✔️ Finalizada';
  if (estado === 'PROGRAMADA') return '📅 Programada';
  if (estado === 'CANCELADA') return '🚫 Cancelada';
  return '🟢 En Curso';
}

// Provider "limpio" de una sección (fallback a 'Otros' si viene vacío)
function providerDeSeccion(s) {
  return (s.Provider && s.Provider.trim()) ? s.Provider.trim() : 'Otros';
}

// Elimina secciones repetidas por código (data duplicada en el CRM). Conserva la
// primera aparición de cada código de sección.
function dedupSecciones(secciones) {
  const vistas = {};
  const salida = [];
  secciones.forEach(function(s) {
    const clave = String(s.Seccion || '').trim().toUpperCase();
    if (!clave) { salida.push(s); return; } // sin código: no se puede deduplicar
    if (vistas[clave]) return;
    vistas[clave] = true;
    salida.push(s);
  });
  return salida;
}

// Agrupa una lista de secciones por NombreCurso → [{ nombreCurso, provider, secciones:[...] }]
// Cada curso hereda el provider de su primera sección (todas las secciones de un
// curso comparten provider).
function agruparPorCurso(secciones) {
  const mapa = {};
  const orden = [];
  secciones.forEach(function(s) {
    const clave = s.NombreCurso || s.Seccion;
    if (!mapa[clave]) { mapa[clave] = { provider: providerDeSeccion(s), secciones: [] }; orden.push(clave); }
    mapa[clave].secciones.push(s);
  });
  return orden.map(function(clave) {
    return { nombreCurso: clave, provider: mapa[clave].provider, secciones: mapa[clave].secciones };
  });
}

// ============================================
// ============================================
// ELEGIR SECCIÓN — agrupadas por curso, con estado al lado
// Formato:
//   <NombreCurso>:
//   N. CODIGO | 🟢 En Curso
// Numeración corrida (1,2,3...) para que el usuario responda con un número.
// ============================================
function preguntarSeccion(phoneNumber, sesion, secciones) {
  // Orden de prioridad de estado dentro de cada curso
  const prioridadEstado = { 'EN_PROGRESO': 0, 'PROGRAMADA': 1, 'FINALIZADA': 2 };
  function pesoEstado(s) {
    const p = prioridadEstado[s.EstadoSeccion];
    return (p === undefined) ? 3 : p;
  }

  // Agrupar por curso (conserva el orden de aparición del curso)
  const cursos = agruparPorCurso(secciones);

  // Aplanar en el mismo orden en que se numera/renderiza, ordenando las
  // secciones de cada curso por estado. Así el índice elegido coincide.
  const ordenadas = [];
  cursos.forEach(function(c) {
    const secs = c.secciones.slice().sort(function(a, b) { return pesoEstado(a) - pesoEstado(b); });
    secs.forEach(function(s) { ordenadas.push(s); });
  });

  sesion.seleccionandoCurso = true;
  sesion.opcionesCursos = ordenadas;
  guardarSesion(phoneNumber, sesion);

  const config = getConfig();
  let texto = (config['MENSAJE_SELECCIONAR_SECCION'] || '📅 Elige la sección:') + '\n';
  const emojis = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.'];

  let idx = 0;
  cursos.forEach(function(c) {
    // Encabezado del curso
    texto += '\n\n*' + c.nombreCurso + ':*';
    const secs = c.secciones.slice().sort(function(a, b) { return pesoEstado(a) - pesoEstado(b); });
    secs.forEach(function(s) {
      texto += '\n' + emojis[idx] + ' ' + s.Seccion + ' | ' + etiquetaEstadoSeccion(s.EstadoSeccion);
      idx++;
    });
  });

  texto += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número.') + '_';
  texto += '\n_' + (config['MENSAJE_VOLVER_MENU'] || 'Escribe *0* para volver o *menu* para el menú principal.').replace(/^_|_$/g, '') + '_';
  enviarMensajeTexto(phoneNumber, texto);
}

// ============================================
// CARGAR DATOS DE UNA SECCIÓN Y MOSTRAR SU SUBMENÚ
// ============================================
function cargarSeccionYMostrar(phoneNumber, sesion, seccion) {
  const crmConfig = getConfig();
  const ss = SpreadsheetApp.openById(crmConfig['CRM_SHEET_ID']);
  const seccionData = obtenerDatosSeccion(seccion.Seccion, ss);
  if (seccionData) {
    sesion.userData.seccionData = seccionData;
  }
  sesion.seccionSeleccionada = seccion;
  delete sesion.seleccionandoCurso;

  const nodoDestino = sesion.audiencia === 'DOCENTE' ? 'D_CLASE' : 'A_CURSO';
  sesion.nodoActual = nodoDestino;
  guardarSesion(phoneNumber, sesion);
  mostrarHijos(phoneNumber, nodoDestino, sesion);
}

// ============================================
// OBTENER MATRÍCULAS ACTIVAS DEL USUARIO
// ============================================
function obtenerMatriculasActivas(sesion) {
  if (!sesion.userData || !sesion.userData.matriculas) return [];
  return sesion.userData.matriculas.filter(function(m) {
    return m.EstadoMatricula !== 'Retirado';
  });
}

// ============================================
// MOSTRAR HIJOS DE UN NODO (como texto numerado)
// ============================================
function mostrarHijos(phoneNumber, padreId, sesion) {
  const menu = getMenu();
  const hijos = menu.filter(function(n) {
    return n.PADRE === padreId && n.ACTIVO === 'SI';
  }).sort(function(a, b) {
    return (parseInt(a.ORDEN) || 99) - (parseInt(b.ORDEN) || 99);
  });

  if (hijos.length === 0) {
    enviarMensajeTexto(phoneNumber, 'No hay opciones disponibles.');
    return;
  }

  // Guardar las opciones en sesión para poder resolver por número.
  // Al mostrar un menú, el usuario ya no está "sobre una acción": limpiar la marca.
  sesion.opcionesActuales = hijos.map(function(h) { return h.ID; });
  delete sesion.ultimaFueAccion;
  guardarSesion(phoneNumber, sesion);

  const config = getConfig();

  // Texto de encabezado
  const nodoActual = obtenerNodoPorId(padreId);
  const textoHeader = nodoActual && nodoActual.TEXTO_RESPUESTA
    ? nodoActual.TEXTO_RESPUESTA
    : 'Selecciona una opción:';

  // Siempre texto numerado (sin listas ni botones interactivos)
  // Encabezado con la sección seleccionada (en negrita) cuando aplica.
  let texto = encabezadoSeccion(sesion) + textoHeader + '\n';
  const emojis = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.'];
  hijos.forEach(function(h, i) {
    texto += '\n' + emojis[i] + ' ' + h.TITULO_OPCION;
  });

  texto += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número de tu opción.') + '_';

  // Recordatorio de navegación en submenús (no en el menú principal / raíz).
  if (padreId !== 'ALUMNO_ROOT' && padreId !== 'DOCENTE_ROOT') {
    texto += '\n_' + (config['MENSAJE_VOLVER_MENU'] || 'Escribe *0* para volver o *menu* para el menú principal.').replace(/^_|_$/g, '') + '_';
  }
  enviarMensajeTexto(phoneNumber, texto);
}

// ============================================
// GATE DE BENEFICIO POR MODALIDAD
// Devuelve un mensaje de bloqueo si el nodo requiere un beneficio que la
// modalidad del alumno no incluye; devuelve null si puede continuar.
// Solo aplica a ALUMNO (los docentes no tienen modalidad).
// ============================================
function verificarBeneficioModalidad(nodo, userData, config) {
  if (!nodo || !userData) return null;
  const matriculaActiva = (userData.matriculas || []).find(function(m) { return m.EstadoMatricula !== 'Retirado'; });
  if (!matriculaActiva) return null;
  const modalidad = (matriculaActiva.Modalidad || '').trim();
  const benef = beneficiosDeModalidad(modalidad);
  if (!benef) return null; // sin datos de modalidad → no bloquear

  // Nodos que requieren simulador incluido
  if (nodo.ID === 'A_SIM_ACCESO' && !benef.simulador) {
    const t = config['MSG_SIMULADOR_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye el simulador de práctica. Elige "Otra consulta" para consultar un upgrade de plan.';
    return reemplazarVariables(t, userData, config);
  }
  // Nodos que requieren grabaciones incluidas
  if (nodo.ID === 'A_CURSO_GRAB' && !benef.grabaciones) {
    const t = config['MSG_GRABACIONES_NO'] || 'ℹ️ Tu plan *{modalidad}* no incluye grabaciones de las clases. Elige "Otra consulta" para consultar un upgrade de plan.';
    return reemplazarVariables(t, userData, config);
  }
  return null;
}

// Devuelve el parámetro CRM de un nodo (en minúsculas) o ''.
function paramNodo(nodo) {
  return String((nodo && nodo.PARAMETRO_ACCION) || '').trim().toLowerCase();
}

// ============================================
// GATE POR ESTADO DE LA SECCIÓN (tarea D + J2)
// - FINALIZADA: no tiene sentido próxima clase, link de Meet ni horario.
// - PROGRAMADA (aún no inicia): no mostrar próxima clase ni Meet; el Meet aparece
//   recién cuando la sección pasa a EN_CURSO (el día que inicia el curso).
// Devuelve mensaje de bloqueo o null si puede continuar.
// ============================================
function verificarDisponibilidadPorEstado(nodo, sesion, config) {
  const sec = sesion && sesion.seccionSeleccionada;
  if (!sec) return null;
  const estado = sec.EstadoSeccion;
  const p = paramNodo(nodo);

  if (estado === 'FINALIZADA') {
    if (p === 'meet_url' || p === 'proxima_clase' || p === 'horario') {
      return config['MSG_NO_DISPONIBLE_FINALIZADA'] ||
        'ℹ️ Esta sección ya finalizó, por lo que no hay próxima clase, enlace de reunión ni horario vigente.';
    }
  }
  if (estado === 'PROGRAMADA') {
    // En programada se bloquea el enlace de Meet (aparece el día que inicia),
    // pero "próxima clase" SÍ se muestra (la primera fecha, sin Meet).
    if (p === 'meet_url') {
      return config['MSG_NO_DISPONIBLE_PROGRAMADA'] ||
        'ℹ️ El curso aún no inicia. El enlace de la clase estará disponible el día de inicio.';
    }
  }
  return null;
}

// ============================================
// GATE POR PAGO (tarea F) — solo ALUMNO
// Si el alumno no ha completado el pago del curso, NO accede a material,
// grabaciones ni classroom. Sí puede ver fechas/horarios/otras consultas.
// Replica el umbral del CRM:
//   Pro/Basic:       totalPagado >= precio
//   Certify/Custom:  totalPagado >= precio - montoExamen
// Devuelve mensaje de bloqueo o null.
// ============================================
function verificarPagoMateriales(nodo, sesion, config) {
  if (!sesion || sesion.audiencia !== 'ALUMNO') return null;
  const p = paramNodo(nodo);
  const esMaterial = (p === 'drive_url' || p === 'classroom_url');
  if (!esMaterial) return null;

  // Matrícula de la sección seleccionada (o la primera activa como fallback)
  const sec = sesion.seccionSeleccionada;
  const matriculas = (sesion.userData && sesion.userData.matriculas) || [];
  let m = null;
  if (sec) {
    m = matriculas.find(function(x) { return x.Seccion === sec.Seccion; });
  }
  if (!m) m = matriculas.find(function(x) { return x.EstadoMatricula !== 'Retirado'; });
  if (!m) return null; // sin datos → no bloquear

  const modalidad = (m.Modalidad || 'Pro').trim();
  const precio = parseFloat(m.PrecioTotal) || 0;
  const pagado = parseFloat(m.TotalPagado) || 0;
  const montoExamen = parseFloat(m.MontoExamen) || 0;
  const umbral = ((modalidad === 'Certify' || modalidad === 'Custom') && montoExamen > 0)
    ? (precio - montoExamen)
    : precio;

  const desbloqueado = pagado >= umbral && pagado > 0;
  if (desbloqueado) return null;

  const t = config['MSG_MATERIALES_NO_PAGO'] ||
    'ℹ️ Los materiales, grabaciones y classroom estarán disponibles cuando completes el pago de tu curso. Escribe *0* para volver.';
  return reemplazarVariables(t, sesion.userData, config);
}

// ============================================
// EJECUTAR ACCIÓN DE UN NODO HOJA
// ============================================
function ejecutarAccion(phoneNumber, nodo, sesion, config) {
  const tipoAccion = (nodo.TIPO_ACCION || 'TEXTO').toUpperCase();
  let textoRespuesta = nodo.TEXTO_RESPUESTA || '';
  const userData = sesion.userData;
  // Encabezado de sección (en negrita) que se antepone a las respuestas de
  // contenido cuando el usuario está dentro de una sección seleccionada.
  const encab = encabezadoSeccion(sesion);

  // Gates de bloqueo (en orden): estado de la sección, pago de materiales,
  // y beneficio por modalidad. El primero que aplique corta la ejecución.
  const bloqueo =
    verificarDisponibilidadPorEstado(nodo, sesion, config) ||
    verificarPagoMateriales(nodo, sesion, config) ||
    verificarBeneficioModalidad(nodo, userData, config);
  if (bloqueo) {
    enviarMensajeTexto(phoneNumber, encab + bloqueo);
    sesion.ultimaFueAccion = true;
    guardarSesion(phoneNumber, sesion);
    Utilities.sleep(500);
    enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');
    registrarLog(phoneNumber, nodo.ID, 'BLOQUEO', false, 0, sesion);
    return;
  }

  switch (tipoAccion) {
    case 'TEXTO':
      textoRespuesta = reemplazarVariables(textoRespuesta, userData, config);
      enviarMensajeTexto(phoneNumber, encab + textoRespuesta);
      break;

    case 'CRM_CONSULTA':
      var datosCRM = obtenerDatosCRM(nodo.PARAMETRO_ACCION, userData, config);

      // Casos que devuelven un objeto { texto, meetUrl? } con plantilla editable
      // de CONFIGURACION (beneficios por modalidad, próxima clase). Se resuelven
      // variables; si trae meetUrl, se adjunta el botón para unirse.
      if (datosCRM && typeof datosCRM === 'object' && datosCRM.texto) {
        enviarMensajeTexto(phoneNumber, encab + reemplazarVariables(datosCRM.texto, userData, config));
        // No adjuntar el botón de Meet si la sección aún no inicia (PROGRAMADA):
        // en ese caso se muestra la fecha de la próxima clase, pero sin enlace.
        var seccionProgramada = sesion.seccionSeleccionada && sesion.seccionSeleccionada.EstadoSeccion === 'PROGRAMADA';
        if (datosCRM.meetUrl && !seccionProgramada) {
          Utilities.sleep(300);
          enviarMensajeBotonUrl(phoneNumber, nodo.TEXTO_BOTON_URL || 'Unirse a la clase', datosCRM.meetUrl);
        }
        break;
      }

      // Si el nodo entrega una URL (botón) pero el dato no existe, dar un mensaje claro
      var esperaUrl = /\{(meet_url|drive_url|classroom_url)\}/i.test(nodo.URL_ADJUNTO || '');
      if (esperaUrl && !datosCRM) {
        enviarMensajeTexto(phoneNumber, config['MENSAJE_ENLACE_NO_DISPONIBLE'] || 'ℹ️ Ese enlace aún no está disponible para tu sección. Si crees que es un error, escribe *0* para volver y elige "Otra consulta" para avisar al área académica.');
        break;
      }
      textoRespuesta = reemplazarVariables(textoRespuesta, userData, config);
      textoRespuesta = textoRespuesta.replace(/\{valor\}/gi, datosCRM || 'No disponible');
      enviarMensajeTexto(phoneNumber, encab + textoRespuesta);
      // Si hay URL adjunta, enviar botón
      if (nodo.URL_ADJUNTO && datosCRM) {
        Utilities.sleep(300);
        enviarMensajeBotonUrl(phoneNumber, nodo.TEXTO_BOTON_URL || 'Abrir', datosCRM);
      }
      break;

    case 'ENLACE':
      textoRespuesta = reemplazarVariables(textoRespuesta, userData, config);
      enviarMensajeTexto(phoneNumber, encab + textoRespuesta);
      const url = reemplazarVariables(nodo.URL_ADJUNTO || '', userData, config);
      if (url) {
        Utilities.sleep(300);
        enviarMensajeBotonUrl(phoneNumber, nodo.TEXTO_BOTON_URL || 'Abrir', url);
      }
      break;

    case 'DRIVE':
      const driveUrl = obtenerDatosCRM('drive_url', userData, config);
      textoRespuesta = reemplazarVariables(textoRespuesta, userData, config);
      enviarMensajeTexto(phoneNumber, encab + textoRespuesta);
      if (driveUrl) {
        Utilities.sleep(300);
        enviarMensajeBotonUrl(phoneNumber, nodo.TEXTO_BOTON_URL || 'Abrir carpeta', driveUrl);
      }
      break;

    case 'DERIVAR':
      textoRespuesta = textoRespuesta || config['MENSAJE_DERIVAR'];
      enviarMensajeTexto(phoneNumber, textoRespuesta);
      // Activar modo "esperando descripción" para capturar el siguiente mensaje
      sesion.esperandoDescripcion = true;
      sesion.nodoDerivacion = nodo.ID;
      guardarSesion(phoneNumber, sesion);
      registrarLog(phoneNumber, nodo.ID, 'DERIVAR', true, 0, sesion);
      return; // No mostrar "volver" todavía, esperar el mensaje del alumno

    case 'CAMBIO_DATOS':
      // Solo alumnos pueden cambiar sus datos por esta vía
      if (sesion.audiencia !== 'ALUMNO') {
        enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_SOLO_ALUMNO'] || 'ℹ️ Esta opción está disponible solo para alumnos.');
        Utilities.sleep(300);
        enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');
        return;
      }
      iniciarFlujoCambioDatos(phoneNumber, sesion, config);
      registrarLog(phoneNumber, nodo.ID, 'CAMBIO_DATOS', true, 0, sesion);
      return; // Espera el input del usuario en procesarFlujoCambioDatos

    case 'HONORARIOS':
      // Solo docentes. Muestra los honorarios de la última sección finalizada
      // y de la sección en curso (si tiene).
      if (sesion.audiencia !== 'DOCENTE') {
        enviarMensajeTexto(phoneNumber, config['MSG_HONORARIOS_SOLO_DOCENTE'] || 'ℹ️ Esta opción está disponible solo para docentes.');
        Utilities.sleep(300);
        enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');
        return;
      }
      iniciarFlujoHonorarios(phoneNumber, sesion, config);
      registrarLog(phoneNumber, nodo.ID, 'HONORARIOS', true, 0, sesion);
      return;

    case 'CONSTANCIA':
      // Solo alumnos. Pregunta la sección si tiene varias y muestra la constancia.
      if (sesion.audiencia !== 'ALUMNO') {
        enviarMensajeTexto(phoneNumber, config['MSG_CAMBIO_SOLO_ALUMNO'] || 'ℹ️ Esta opción está disponible solo para alumnos.');
        Utilities.sleep(300);
        enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *9* para el menú principal._');
        return;
      }
      iniciarFlujoConstancia(phoneNumber, sesion, config);
      registrarLog(phoneNumber, nodo.ID, 'CONSTANCIA', true, 0, sesion);
      return;

    default:
      enviarMensajeTexto(phoneNumber, textoRespuesta || config['MENSAJE_DERIVAR']);
  }

  // Marcar que lo último mostrado fue una acción hoja: así, al escribir "0", se
  // vuelve a mostrar el submenú actual (donde está el nodo) en lugar de subir un
  // nivel. Esto mantiene al usuario en el submenú del curso tras ver un enlace/texto.
  sesion.ultimaFueAccion = true;
  guardarSesion(phoneNumber, sesion);

  // Después de la acción, ofrecer volver
  Utilities.sleep(500);
  enviarMensajeTexto(phoneNumber, config['MENSAJE_VOLVER_MENU'] || '_Escribe *0* para volver o *menu* para el menú principal._');

  registrarLog(phoneNumber, nodo.ID, nodo.TIPO_ACCION, false, 0, sesion);
}

// ============================================
// BIENVENIDA
// ============================================
function enviarBienvenida(phoneNumber, config) {
  const texto = config['MENSAJE_BIENVENIDA'] || '👋 Hola, soy el asistente académico de Cloud Academy. ¿Con quién hablo?';
  let mensaje = texto + '\n\n1. 🎓 Alumno\n2. 👨‍🏫 Docente';
  mensaje += '\n\n_' + (config['MENSAJE_INSTRUCCION_MENU'] || 'Responde con el número de tu opción.') + '_';
  enviarMensajeTexto(phoneNumber, mensaje);
}

// ============================================
// DETECCIÓN DE ROL
// ============================================
function esRespuestaAlumno(t) {
  return t === 'rol_alumno' || t.includes('alumno') || t.includes('estudiante') || t === '1';
}
function esRespuestaDocente(t) {
  return t === 'rol_docente' || t.includes('docente') || t.includes('profesor') || t === '2';
}


