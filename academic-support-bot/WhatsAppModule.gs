// ============================================
// Cloud Academy Bot v2 - WhatsAppModule.gs
// Envío de mensajes via Meta WhatsApp API
// ============================================

const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0/';

// ============================================
// ENVIAR TEXTO
// ============================================
function enviarMensajeTexto(phoneNumber, texto) {
  try {
    const config = getConfig();
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'text',
      text: { preview_url: false, body: texto }
    };
    return llamarWhatsAppAPI(config['WHATSAPP_PHONE_NUMBER_ID'], config['WHATSAPP_ACCESS_TOKEN'], payload);
  } catch (error) {
    Logger.log('❌ Error enviarTexto: ' + error.toString());
    return false;
  }
}

// ============================================
// ENVIAR BOTÓN URL (CTA)
// ============================================
function enviarMensajeBotonUrl(phoneNumber, textoBoton, url) {
  try {
    const config = getConfig();
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: ' ' },
        action: {
          name: 'cta_url',
          parameters: { display_text: textoBoton.substring(0, 20), url: url }
        }
      }
    };

    const ok = llamarWhatsAppAPI(config['WHATSAPP_PHONE_NUMBER_ID'], config['WHATSAPP_ACCESS_TOKEN'], payload);
    if (!ok) {
      enviarMensajeTexto(phoneNumber, '🔗 ' + textoBoton + ': ' + url);
    }
    return ok;
  } catch (error) {
    Logger.log('❌ Error enviarBotonUrl: ' + error.toString());
    enviarMensajeTexto(phoneNumber, '🔗 ' + url);
    return false;
  }
}

// ============================================
// NOTIFICAR AL ÁREA ACADÉMICA
// ============================================
function notificarAcademico(phoneNumber, nombre, contexto, emailDestino) {
  try {
    GmailApp.sendEmail(
      emailDestino || 'students@example.com',
      '🚨 Cloud Academy Bot - Derivación',
      'El bot derivó una consulta.\n\n' +
      'Número: +' + phoneNumber + '\n' +
      'Nombre: ' + nombre + '\n' +
      'Contexto: ' + contexto + '\n' +
      'Fecha: ' + new Date().toLocaleString('es-PE', {timeZone: 'America/Lima'})
    );
  } catch (error) {
    Logger.log('⚠️ Error notificación: ' + error.toString());
  }
}

// ============================================
// LLAMADA GENÉRICA A WHATSAPP API
// ============================================
function llamarWhatsAppAPI(phoneId, token, payload) {
  try {
    if (!phoneId || !token) return false;
    const response = UrlFetchApp.fetch(WHATSAPP_API_URL + phoneId + '/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 200 || code === 201) return true;
    Logger.log('❌ WA API ' + code + ': ' + response.getContentText());
    return false;
  } catch (error) {
    Logger.log('❌ Error WA API: ' + error.toString());
    return false;
  }
}
