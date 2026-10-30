// ============================================================
// CloudStorage.gs — Módulo para Google Cloud Storage
// Bucket: your-media-bucket
// Estructura: imagenes/asesor/, imagenes/cliente/, videos/asesor/, etc.
// ============================================================

/**
 * Obtiene un access token para la service account usando JWT.
 */
function getGCSAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("gcs_token");
  if (cached) return cached;

  const keyJson = JSON.parse(PropertiesService.getScriptProperties().getProperty("GCS_SERVICE_ACCOUNT_KEY"));
  const now = Math.floor(Date.now() / 1000);

  // Crear JWT
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: keyJson.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));

  const signatureInput = header + "." + claim;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(signatureInput, keyJson.private_key)
  );

  const jwt = signatureInput + "." + signature;

  // Intercambiar JWT por access token
  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    console.log("❌ GCS token error: " + res.getContentText());
    return null;
  }

  // Cachear por 55 minutos (token dura 60)
  cache.put("gcs_token", data.access_token, 3300);
  return data.access_token;
}

/**
 * Sube un archivo a Cloud Storage.
 * @param {Blob} blob - El archivo como blob
 * @param {string} path - Ruta dentro del bucket (ej: "imagenes/asesor/12345_foto.jpg")
 * @param {string} contentType - MIME type (ej: "image/jpeg")
 * @returns {string|null} URL pública del objeto o null si falló
 */
function subirACloudStorage(blob, path, contentType) {
  const token = getGCSAccessToken();
  if (!token) return null;

  const bucket = PropertiesService.getScriptProperties().getProperty("GCS_BUCKET") || "your-media-bucket";
  const url = "https://storage.googleapis.com/upload/storage/v1/b/" + bucket + "/o?uploadType=media&name=" + encodeURIComponent(path);

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: contentType,
    headers: { Authorization: "Bearer " + token },
    payload: blob.getBytes(),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code === 200) {
    const data = JSON.parse(res.getContentText());
    console.log("✅ GCS upload OK: " + path);
    return "gs://" + bucket + "/" + path;
  } else {
    console.log("❌ GCS upload error " + code + ": " + res.getContentText().substring(0, 200));
    return null;
  }
}

/**
 * Descarga un archivo de una URL y lo sube a Cloud Storage.
 * Usado para guardar media que el cliente envía por WhatsApp.
 * @param {string} mediaUrl - URL de Meta para descargar el archivo
 * @param {string} path - Ruta destino en el bucket
 * @param {string} contentType - MIME type
 * @returns {string|null} GCS path o null
 */
function descargarYSubirAGCS(mediaUrl, path, contentType) {
  const cfg = getProps();
  const token = cfg["ACCESS_TOKEN"] || cfg["WA_TOKEN"];

  // Descargar de Meta
  const res = UrlFetchApp.fetch(mediaUrl, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    console.log("❌ Error descargando media de Meta: " + res.getResponseCode());
    return null;
  }

  const blob = res.getBlob().setContentType(contentType);

  // Validar tamaño (max 2MB)
  if (blob.getBytes().length > 2 * 1024 * 1024) {
    console.log("⚠️ Archivo mayor a 2MB, no se guarda en GCS");
    return null;
  }

  return subirACloudStorage(blob, path, contentType);
}

/**
 * Genera una URL firmada temporal para ver un archivo de GCS (válida 1 hora).
 * Útil para mostrar thumbnails en el panel.
 * @param {string} path - Ruta del objeto en el bucket
 * @returns {string} URL firmada
 */
function getGCSSignedUrl(path) {
  const bucket = PropertiesService.getScriptProperties().getProperty("GCS_BUCKET") || "your-media-bucket";
  const token = getGCSAccessToken();
  if (!token) return "";

  // URL directa autenticada (no firmada, pero funciona para el panel que ya tiene sesión)
  return "https://storage.googleapis.com/" + bucket + "/" + encodeURIComponent(path);
}


// ============================================================
// Guardar media que envía el cliente por WhatsApp
// 1. Obtener URL de descarga de Meta
// 2. Descargar el archivo
// 3. Subirlo a Cloud Storage
// ============================================================
function guardarMediaCliente(telefono, mediaId, tipo, mediaObj) {
  const cfg = getProps();
  const token = cfg["ACCESS_TOKEN"] || cfg["WA_TOKEN"];
  if (!token) { logSheet("mediaCliente", "❌ ERROR", "Falta ACCESS_TOKEN"); return ""; }

  // 1. Obtener URL de descarga de Meta
  const metaRes = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + mediaId, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });

  if (metaRes.getResponseCode() !== 200) {
    logSheet("mediaCliente", "❌ ERROR", "No se obtuvo URL de media (" + tipo + ") " + metaRes.getResponseCode() + ": " + metaRes.getContentText().substring(0,150));
    return "";
  }

  const metaData = JSON.parse(metaRes.getContentText());
  const downloadUrl = metaData.url;
  const mimeType = metaData.mime_type || "application/octet-stream";

  if (!downloadUrl) {
    logSheet("mediaCliente", "❌ ERROR", "URL de descarga vacía para media " + mediaId);
    return "";
  }

  // 2. Descargar el archivo de Meta
  const fileRes = UrlFetchApp.fetch(downloadUrl, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });

  if (fileRes.getResponseCode() !== 200) {
    logSheet("mediaCliente", "❌ ERROR", "No se pudo descargar media de Meta: " + fileRes.getResponseCode());
    return "";
  }

  const blob = fileRes.getBlob().setContentType(mimeType);
  const bytes = blob.getBytes().length;

  // Límite de tamaño: imágenes 16MB (margen sobre el máx de WhatsApp ~5MB),
  // videos/documentos 25MB. Apps Script maneja blobs hasta ~50MB.
  const LIMITE = (tipo === "image") ? 16 * 1024 * 1024 : 25 * 1024 * 1024;
  if (bytes > LIMITE) {
    logSheet("mediaCliente", "⚠️ WARNING",
      tipo + " de " + telefono + " supera el límite (" + Math.round(bytes/1024/1024) + "MB > " +
      Math.round(LIMITE/1024/1024) + "MB), no se guarda en GCS");
    return "";
  }

  // 3. Determinar carpeta y extensión (según mime real)
  var carpeta = "imagenes/cliente/";
  var extension = "jpg";
  if (tipo === "video") {
    carpeta = "videos/cliente/";
    extension = mimeType.includes("3gpp") ? "3gp" : "mp4";
  } else if (tipo === "document") {
    carpeta = "documentos/cliente/";
    // Extensión según el mime real del documento
    if (mimeType.includes("pdf")) extension = "pdf";
    else if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) extension = "docx";
    else if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel")) extension = "xlsx";
    else if (mimeType.includes("presentationml") || mimeType.includes("ms-powerpoint")) extension = "pptx";
    else if (mimeType.includes("text/plain")) extension = "txt";
    else {
      // Intentar usar el nombre de archivo original si Meta lo mandó
      const fn = (mediaObj && mediaObj.filename) ? mediaObj.filename : "";
      const m = fn.match(/\.([a-z0-9]{2,5})$/i);
      extension = m ? m[1].toLowerCase() : "bin";
    }
  } else if (mimeType === "image/png") {
    extension = "png";
  }

  var path = carpeta + telefono + "_" + Date.now() + "." + extension;

  // 4. Subir a Cloud Storage
  const gcsUrl = subirACloudStorage(blob, path, mimeType);
  if (gcsUrl) {
    logSheet("mediaCliente", "✅ OK", tipo + " de " + telefono + " guardado: " + path);
    return path;
  }
  logSheet("mediaCliente", "❌ ERROR", "subirACloudStorage devolvió vacío para " + tipo + " de " + telefono + " (" + path + ")");
  return "";
}
