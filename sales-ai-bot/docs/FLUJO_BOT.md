# Flujo del Bot — Estados, Mensajes, Botones y Acciones

## Estados del bot (`ESTADO`)

| Estado | Descripción |
|---|---|
| `INICIO` | Primera interacción — se envía saludo |
| `NO_E_NUBE` | Esperando que elija provider (AWS, Azure, GCP) |
| `NO_E_CERT` | Eligió provider — esperando que elija certificación |
| `NO_E_URGENCIA` | Eligió cert — esperando tiempo estimado |
| `NO_CONFIRMO_MEET` | Recibió link de agendamiento — aún no confirmó |
| `CONFIRMO_MEET` | Clickeó "Ya agendé" |
| `RECONFIRMO_MEET` | Clickeó "Confirmar asistencia" (seguimiento 30min) |
| `MAS_DE_60_DIAS` | Eligió 60 días a más — estado terminal |
| `REMARKETING_FALLIDO` | No respondió seguimientos o no asistió — estado terminal |
| `ALINEACION` | Legacy — redirige a NO_E_URGENCIA |

---

## Flujo principal

```
INICIO
  └─ enviarSaludo → imagen MSG_IMG_SALUDO + botones de provider
       └─ NO_E_NUBE
            └─ elige provider → imagen MSG_IMG_CERTS_[PROVIDER] + lista de certs
                 └─ NO_E_CERT
                      └─ elige cert → imagen MSG_IMG_CERT_[certId] + pregunta de tiempo
                           └─ NO_E_URGENCIA
                                ├─ btn_2sem / btn_30dias → MSG_AGENDAR_ASESOR + link → NO_CONFIRMO_MEET
                                └─ btn_60dias → MSG_60DIAS → MAS_DE_60_DIAS
```

---

## IDs de botones

| ID | Dónde aparece |
|---|---|
| `btn_[PROVIDER]` | Saludo — dinámico según sheet Asesor |
| `btn_menu_principal` | Múltiples puntos del flujo |
| `btn_2sem` | Pregunta de urgencia |
| `btn_30dias` | Pregunta de urgencia |
| `btn_60dias` | Pregunta de urgencia |
| `btn_confirmar_agendar` | Después de recibir link de agendamiento |
| `btn_reconfirmar` | Seguimiento 30min a CONFIRMO_MEET |
| `btn_agendar_asesor` | Bloque de precios |

---

## Claves del sheet de Mensajes

### Flujo principal

| Clave | Uso | Variables |
|---|---|---|
| `MSG_SALUDO` | Bienvenida con botones de provider | — |
| `MSG_IMG_SALUDO` | media_id imagen de saludo | — |
| `MSG_CERTS_DISPONIBLES` | Intro lista de certificaciones | `{provider}` |
| `MSG_IMG_CERTS_AWS` | media_id imagen certs AWS | — |
| `MSG_IMG_CERTS_AZURE` | media_id imagen certs Azure | — |
| `MSG_IMG_CERTS_GCP` | media_id imagen certs GCP | — |
| `MSG_IMG_CERT_[certId]` | media_id imagen por certificación (ej: `MSG_IMG_CERT_AZ900`) | — |
| `MSG_TIEMPO` | Pregunta de urgencia | — |
| `MSG_AGENDAR_ASESOR` | Envío del link de agendamiento | `{link}` |
| `MSG_60DIAS` | Respuesta a quien eligió 60 días | — |
| `MSG_GRACIAS_AGENDA` | Confirmación de agendamiento | — |
| `MSG_REINICIAR` | Estados terminales — ofrecer volver | — |
| `MSG_ERROR_OPCIONES` | Opción inválida | — |

### Precios

| Clave | Uso | Variables |
|---|---|---|
| `MSG_IMAGEN_PRECIO_1` | media_id imagen precios 1 | — |
| `MSG_IMAGEN_PRECIO_2` | media_id imagen precios 2 | — |
| `MSG_PRECIO` | Texto de precios con link | `{link}` |

### Botones (títulos)

| Clave | Botón |
|---|---|
| `MSG_BTN_VER_CERTS` | "Ver certificaciones" |
| `MSG_BTN_2SEM` | "2 semanas" |
| `MSG_BTN_30DIAS` | "30 días" |
| `MSG_BTN_60DIAS` | "60 días a más" |
| `MSG_BTN_CONFIRM` | "Ya agendé" |
| `MSG_BTN_MENU` | "Menú principal" |
| `MSG_BTN_RECONFIRM` | "Confirmar reunión" |
| `MSG_BTN_AGENDAR_ASESOR` | "Agendar asesor" |

---

## Columna ACCION — valores registrados

| Valor | Cuándo |
|---|---|
| `inicio` | Primera interacción |
| `[provider en minúsculas]` | Ej: `aws`, `azure` |
| `[certId]` | Ej: `az900`, `clf` |
| `2_semanas` / `30_dias` / `60_dias` | Elige urgencia |
| `precio_enviado` | Consulta palabras de precio |
| `confirmo_meet` | Click en "Ya agendé" |
| `reconfirmo_meet` | Click en "Confirmar reunión" |
| `reactivado_remarketing` | Vuelve a pedir link desde estado avanzado |
| `reinicio` | Click en "Menú principal" |

> Los seguimientos automáticos se concatenan con ` > ` sobre el valor existente. Ver `SEGUIMIENTOS.md`.

---

## Columnas del sheet `Información_Webhook`

| Col | Índice | Campo | Descripción |
|---|---|---|---|
| A | 0 | TIMESTAMP | Última actualización |
| B | 1 | TELF | Teléfono del lead |
| C | 2 | PROVIDER | AWS / AZURE / GCP |
| D | 3 | CURSO | Certificación elegida (se conserva al reiniciar) |
| E | 4 | CTA | — |
| F | 5 | MEDIO_PAGO | — |
| G | 6 | ASESOR | Nombre del asesor asignado |
| H | 7 | ACCION | Historial acumulado de acciones |
| I | 8 | MENSAJES_CLIENTE | Mensajes enviados por el cliente |
| J | 9 | ULTIMO_MSG_BOT | Último mensaje enviado por el bot |
| K | 10 | ESTADO_BOT | Estado actual del lead |
| L | 11 | MENSAJE | Control interno — no tocar |
| M | 12 | LLAMADA | Control interno — no tocar |
| N | 13 | ESTADO_GESTION | `"remarketing"` activa el seguimiento de 22h |
| O | 14 | MODALIDAD | — |
| P | 15 | TIMESTAMP_0 | Primera interacción — nunca se sobreescribe |

---

## Detección de precios

El bot detecta palabras clave en **cualquier estado** del flujo:

```
["precio", "precios", "costo", "costos", "cuanto cuesta", "cuánto cuesta",
 "valor", "valores", "cuanto vale", "cuánto vale", "inversión", "inversion"]
```

Al detectarlas envía: imagen 1 → texto+botón → imagen 2, y registra `precio_enviado` en ACCION.
