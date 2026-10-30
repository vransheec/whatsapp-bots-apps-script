# Guía de Setup — Para quien continúa el proyecto

## Requisitos previos

- Cuenta de Google con acceso a los Google Sheets del proyecto
- [Node.js](https://nodejs.org) instalado
- [clasp](https://github.com/google/clasp) instalado: `npm install -g @google/clasp`
- Acceso a la app de Meta WhatsApp Business API

---

## 1. Clonar el repositorio

```bash
git clone <URL_DE_TU_REPOSITORIO>
cd sales-ai-bot
```

---

## 2. Autenticar clasp

```bash
clasp login
```

Autoriza con la cuenta de Google que tiene acceso a los proyectos de Apps Script.

---

## 3. Crear `config.gs` (script principal)

Copia `ConfigTemplate.gs` como `config.gs` y completa los valores reales:

```bash
cp ConfigTemplate.gs config.gs
```

Edita `config.gs`:

```javascript
const CONFIG = {
  CALENDAR_ID:     "id_del_google_calendar",
  SHEET_ID:        "id_del_sheet_leads",
  CONFIG_SHEET_ID: "id_del_sheet_config",
  VERIFY_TOKEN:    "token_de_verificacion_meta",
  DATA_SHEET_ID:   "id_del_sheet_bot"
};
```

> `config.gs` está en `.gitignore` — nunca se sube al repo.

---

## 4. Estructura de Google Sheets

### Sheet principal (SHEET_ID)
Hojas requeridas:
- **Leads** — leads con columnas mapeadas por `FIELD_ALIASES` en `Code.gs`
- **Asesores** — columnas: PROVIDER | NOMBRE | CORREO

### Sheet de Config (CONFIG_SHEET_ID)
Columna A: clave | Columna B: valor

| Clave | Descripción |
|---|---|
| `WA_PHONE_ID` | Phone Number ID de Meta |
| `WA_TOKEN` | Access Token de Meta |

### Sheet de datos del bot (DATA_SHEET_ID)
Hojas requeridas:
- **Información_Webhook** — ver columnas en `docs/FLUJO_BOT.md`
- **Asesor** — columnas: PROVIDER | ASESOR | CORREO | LINK_AGENDAMIENTO | NOMBRE_BOTON
- **Cursos** — columnas: PROVIDER | CERT_ID | NOMBRE_CERT
- **Mensajes** — columnas: CLAVE | TEXTO (ver lista completa abajo)
- **Logs** — columnas: TIMESTAMP | FUNCION | ESTADO | DETALLE

### Sheet de Config del bot (CONFIG_SHEET_ID_BOT — hardcodeado en Bot.gs)
Columna A: clave | Columna B: valor

| Clave | Descripción |
|---|---|
| `ACCESS_TOKEN` | Access Token de Meta WhatsApp API |
| `PHONE_NUMBER_ID` | Phone Number ID de Meta |
| `TEST_NUMBER` | Número de prueba (ej: `000000000000`) |

---

## 5. Sheet de Mensajes — claves requeridas

### Flujo principal
| Clave | Descripción |
|---|---|
| `MSG_SALUDO` | Bienvenida |
| `MSG_IMG_SALUDO` | media_id imagen saludo |
| `MSG_CERTS_DISPONIBLES` | Intro lista certs. Usa `{provider}` |
| `MSG_IMG_CERTS_AWS` | media_id imagen certs AWS |
| `MSG_IMG_CERTS_AZURE` | media_id imagen certs Azure |
| `MSG_IMG_CERTS_GCP` | media_id imagen certs GCP |
| `MSG_IMG_CERT_[certId]` | media_id imagen por cert (ej: `MSG_IMG_CERT_AZ900`) |
| `MSG_TIEMPO` | Pregunta de urgencia |
| `MSG_AGENDAR_ASESOR` | Link de agendamiento. Usa `{link}` |
| `MSG_60DIAS` | Respuesta a 60 días |
| `MSG_GRACIAS_AGENDA` | Confirmación agendamiento |
| `MSG_REINICIAR` | Ofrecer volver al menú |
| `MSG_ERROR_OPCIONES` | Opción inválida |

### Precios
| Clave | Descripción |
|---|---|
| `MSG_IMAGEN_PRECIO_1` | media_id imagen precios 1 |
| `MSG_IMAGEN_PRECIO_2` | media_id imagen precios 2 |
| `MSG_PRECIO` | Texto precios. Usa `{link}` |

### Botones
| Clave | Texto del botón |
|---|---|
| `MSG_BTN_VER_CERTS` | "Ver certificaciones" |
| `MSG_BTN_2SEM` | "2 semanas" |
| `MSG_BTN_30DIAS` | "30 días" |
| `MSG_BTN_60DIAS` | "60 días a más" |
| `MSG_BTN_CONFIRM` | "Ya agendé" |
| `MSG_BTN_MENU` | "Menú principal" |
| `MSG_BTN_RECONFIRM` | "Confirmar reunión" |
| `MSG_BTN_AGENDAR_ASESOR` | "Agendar asesor" |

### Seguimientos
| Clave | Descripción |
|---|---|
| `MSG_SEG_18H_NUBE` | Seguimiento 18h NO_E_NUBE |
| `MSG_SEG_18H_CERT` | Seguimiento 18h NO_E_CERT |
| `MSG_SEG_18H_URGENCIA` | Seguimiento 18h NO_E_URGENCIA |
| `MSG_VIDEO_NCM_LINKEDIN` | media_id video seguimiento 30min |
| `MSG_SEG_30MIN_NC` | Texto 30min NO_CONFIRMO_MEET. Usa `{link}` |
| `MSG_IMG_SEG_1H` | media_id imagen 1h |
| `MSG_SEG_1H` | Texto 1h. Usa `{link}` |
| `MSG_IMG_SEG_10H` | media_id imagen 10h |
| `MSG_SEG_10H` | Texto 10h. Usa `{link}` |
| `MSG_IMG_SEG_17H` | media_id imagen 17h |
| `MSG_SEG_17H` | Texto 17h. Usa `{link}` |
| `MSG_SEG_23H_DOLOR` | Texto final dolor |
| `MSG_SEG_30MIN_RC` | Texto 30min CONFIRMO_MEET. Usa `{link}` |
| `MSG_SEG_15H_SIMULADOR` | Texto 15h simulador |
| `MSG_REMARKETING` | Texto remarketing 22h |

---

## 6. Deploy con clasp

### Script principal
```bash
clasp push
```

### Bot
```bash
cd bot
clasp push
```

---

## 7. Instalar triggers (ejecutar UNA VEZ desde Apps Script)

En el editor de Apps Script, ejecutar cada función manualmente:

```javascript
// Script principal
instalarTrigger()            // onChange sobre sheet Leads

// Bot
instalarTriggerSeguimiento() // Seguimientos cada 30 min
instalarWarmupTrigger()      // Warmup cada 5 min

// Métricas
instalarTriggerMetricas()    // Métricas cada hora
```

---

## 8. Subir imágenes y video a Meta

Ejecutar desde el editor de Apps Script del bot:

```javascript
subirImagenesDesdeDrive()   // Sube todas las imágenes y escribe media_ids en sheet Mensajes
subirVideoDesdeDrive()      // Sube el video del seguimiento 30min
```

> Los FILE_IDs de Drive están hardcodeados en estas funciones. Actualízalos si cambias los archivos.
> Las imágenes deben ser PNG y el video MP4 H.264.

---

## 9. Configurar webhook en Meta

1. En Meta for Developers → tu app → WhatsApp → Configuración
2. URL del webhook: URL del deploy web de `bot/Bot.gs`
3. Token de verificación: el valor de `VERIFY_TOKEN` en `config.gs`
4. Suscribirse al campo: `messages`

---

## 10. Verificar funcionamiento

```javascript
probarDoPost()    // Simula un mensaje entrante al bot
limpiarCache()    // Limpia caché del sheet de Mensajes
```

---

## Documentación adicional

- [`docs/FLUJO_BOT.md`](FLUJO_BOT.md) — Estados, mensajes, botones y columnas del sheet
- [`docs/SEGUIMIENTOS.md`](SEGUIMIENTOS.md) — Lógica de seguimientos automáticos
- [`seguimiento_bot.drawio`](../seguimiento_bot.drawio) — Diagrama visual de seguimientos
