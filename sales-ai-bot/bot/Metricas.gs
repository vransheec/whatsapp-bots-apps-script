// ============================================================
// MÉTRICAS — contabiliza cuántas personas se quedan en cada estado
// Ejecutar manualmente o instalar como trigger diario
// ============================================================

function actualizarMetricas(e) {
  const ss        = getDataSS();
  const hojaData  = ss.getSheetByName("LEADS");
  const data      = hojaData.getDataRange().getValues();

  // Contar por estado
  const conteo = {};
  for (let i = 1; i < data.length; i++) {
    const estado = data[i][BCOL.ESTADO_BOT].toString().trim() || "SIN_ESTADO";
    conteo[estado] = (conteo[estado] || 0) + 1;
  }

  // Orden lógico del flujo
  const orden = [
    "INICIO",
    "NO_E_NUBE",
    "NO_E_CERT",
    "NO_E_URGENCIA",
    "NO_CONFIRMO_MEET",
    "CONFIRMO_MEET",
    "RECONFIRMO_MEET",
    "MAS_DE_60_DIAS",
    "REMARKETING_FALLIDO",
    "ALINEACION",
    "SIN_ESTADO"
  ];

  // Escribir en hoja Métricas
  let hojaMetricas = ss.getSheetByName("Métricas");
  if (!hojaMetricas) {
    hojaMetricas = ss.insertSheet("Métricas");
  }
  hojaMetricas.clearContents();

  // Headers
  hojaMetricas.getRange(1, 1, 1, 3).setValues([["ESTADO", "CANTIDAD", "ÚLTIMA ACTUALIZACIÓN"]]);
  hojaMetricas.getRange(1, 1, 1, 3).setFontWeight("bold");

  // Datos en orden lógico
  let fila = 2;
  let total = 0;
  for (const estado of orden) {
    if (conteo[estado]) {
      hojaMetricas.getRange(fila, 1).setValue(estado);
      hojaMetricas.getRange(fila, 2).setValue(conteo[estado]);
      hojaMetricas.getRange(fila, 3).setValue(new Date());
      total += conteo[estado];
      fila++;
    }
  }

  // Agregar estados no contemplados en el orden
  for (const [estado, cant] of Object.entries(conteo)) {
    if (!orden.includes(estado)) {
      hojaMetricas.getRange(fila, 1).setValue(estado);
      hojaMetricas.getRange(fila, 2).setValue(cant);
      hojaMetricas.getRange(fila, 3).setValue(new Date());
      total += cant;
      fila++;
    }
  }

  // Total
  hojaMetricas.getRange(fila, 1).setValue("TOTAL");
  hojaMetricas.getRange(fila, 2).setValue(total);
  hojaMetricas.getRange(fila, 1, 1, 2).setFontWeight("bold");

  Logger.log("✅ Métricas actualizadas. Total leads: " + total);
}

// Instala un trigger para actualizar métricas cada hora
function instalarTriggerMetricas() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "actualizarMetricas") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("actualizarMetricas")
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log("✅ Trigger de métricas instalado (cada hora)");
}
