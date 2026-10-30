# Seguimientos Automáticos

La función `seguimiento30min()` corre cada 30 minutos (trigger time-based) y evalúa todos los leads activos para enviar mensajes según el tiempo transcurrido desde el último `TIMESTAMP`.

---

## Lógica de evaluación

Para cada lead se calcula:
- `minutos` = tiempo desde TIMESTAMP
- `horas` = minutos / 60

Las condiciones de seguimiento evalúan **solo la parte de ACCION después del último `reinicio`**. Esto permite que un lead que reinició el flujo reciba los seguimientos del nuevo ciclo sin interferencia del historial anterior.

---

## Seguimientos por estado

### NO_E_NUBE / NO_E_CERT / NO_E_URGENCIA

| Tiempo | Mensaje | Botones | Marca en ACCION |
|---|---|---|---|
| 18h | `MSG_SEG_18H_NUBE` / `MSG_SEG_18H_CERT` / `MSG_SEG_18H_URGENCIA` | Botones del estado correspondiente | `> seg_18h` |

---

### NO_CONFIRMO_MEET

| Tiempo | Contenido | Botón | Marca en ACCION |
|---|---|---|---|
| 30min | 🎥 `MSG_VIDEO_NCM_LINKEDIN` + `MSG_SEG_30MIN_NC` | btn_confirmar_agendar | `> seg_30min` |
| 1h | 🖼 `MSG_IMG_SEG_1H` + `MSG_SEG_1H` | btn_confirmar_agendar | `> seg_1h` |
| 10h | 🖼 `MSG_IMG_SEG_10H` + `MSG_SEG_10H` | btn_confirmar_agendar | `> seg_10h` |
| 17h | 🖼 `MSG_IMG_SEG_17H` + `MSG_SEG_17H` | btn_confirmar_agendar | `> seg_17h` |
| 23h | `MSG_SEG_23H_DOLOR` | btn_menu_principal | `> seg_23h_dolor` → **REMARKETING_FALLIDO** |

> Las imágenes se envían como mensaje separado antes del texto+botón.
> Los seguimientos son secuenciales — cada uno requiere que el anterior esté en ACCION.

---

### CONFIRMO_MEET

| Tiempo | Mensaje | Botón | Marca en ACCION |
|---|---|---|---|
| 30min | `MSG_SEG_30MIN_RC` | btn_reconfirmar | `> seg_30min_reconfirm` |
| 15h | `MSG_SEG_15H_SIMULADOR` | — (texto libre) | `> seg_15h_simulador` |
| 22h* | `MSG_REMARKETING` | btn_menu_principal | `> remarketing_22h` → **REMARKETING_FALLIDO** |

> *El seguimiento de 22h solo se activa si la columna N del sheet tiene el valor `"remarketing"` (lo marca el asesor manualmente cuando el lead no asistió).

---

### RECONFIRMO_MEET

| Tiempo | Mensaje | Botón | Marca en ACCION |
|---|---|---|---|
| 22h* | `MSG_REMARKETING` | btn_menu_principal | `> remarketing_22h` → **REMARKETING_FALLIDO** |

> *Misma condición que CONFIRMO_MEET — requiere col N = `"remarketing"`.

---

### MAS_DE_60_DIAS / REMARKETING_FALLIDO

Sin seguimientos automáticos. Son estados terminales.

Si el lead escribe de nuevo, el bot ofrece `btn_menu_principal` para reiniciar el flujo.

---

## Claves del sheet de Mensajes para seguimientos

| Clave | Descripción | Variables |
|---|---|---|
| `MSG_SEG_18H_NUBE` | Seguimiento 18h — NO_E_NUBE | — |
| `MSG_SEG_18H_CERT` | Seguimiento 18h — NO_E_CERT | — |
| `MSG_SEG_18H_URGENCIA` | Seguimiento 18h — NO_E_URGENCIA | — |
| `MSG_VIDEO_NCM_LINKEDIN` | media_id video seguimiento 30min | — |
| `MSG_SEG_30MIN_NC` | Texto seguimiento 30min NO_CONFIRMO_MEET | `{link}` |
| `MSG_IMG_SEG_1H` | media_id imagen seguimiento 1h | — |
| `MSG_SEG_1H` | Texto seguimiento 1h | `{link}` |
| `MSG_IMG_SEG_10H` | media_id imagen seguimiento 10h | — |
| `MSG_SEG_10H` | Texto seguimiento 10h | `{link}` |
| `MSG_IMG_SEG_17H` | media_id imagen seguimiento 17h | — |
| `MSG_SEG_17H` | Texto seguimiento 17h | `{link}` |
| `MSG_SEG_23H_DOLOR` | Texto mensaje final dolor | — |
| `MSG_SEG_30MIN_RC` | Texto seguimiento 30min CONFIRMO_MEET | `{link}` |
| `MSG_SEG_15H_SIMULADOR` | Texto seguimiento 15h simulador | — |
| `MSG_REMARKETING` | Texto remarketing 22h | — |

---

## Instalación del trigger

```javascript
instalarTriggerSeguimiento()
```

Crea un trigger `everyMinutes(30)`. Apps Script tiene un límite de 20 triggers por proyecto, por lo que no es posible crear triggers fijos por hora — la función corre cada 30 min y las condiciones de tiempo controlan cuándo se envía cada mensaje.

---

## Subir media a Meta

```javascript
subirImagenesDesdeDrive()  // Sube todas las imágenes del flujo y seguimientos
subirVideoDesdeDrive()     // Sube el video del seguimiento 30min
```

Ambas funciones leen las credenciales del sheet Config, suben el archivo desde Drive a Meta y escriben el `media_id` resultante directamente en el sheet de Mensajes.

> Los archivos deben ser PNG (imágenes) o MP4 H.264 (video) para compatibilidad con WhatsApp.
