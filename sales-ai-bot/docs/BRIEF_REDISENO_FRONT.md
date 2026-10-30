# Brief para rediseño COMPLETO del Front — Panel Admin Cloud Academy Bot

> Copia este documento completo a Claude Desktop. Es el encargo para rediseñar TODO el
> front (todas las páginas). El resultado se revisará y se empalmará en Google Apps Script.

---

## Contexto del producto

Es el **panel de administración de un bot de WhatsApp** para Cloud Academy (academia de
certificaciones tecnológicas: AWS, Azure, GCP, IA, etc.). El bot atiende leads por WhatsApp
guiándolos por un embudo de ventas; el panel permite a los asesores/administradores:
monitorear leads, chatear manualmente, editar el flujo del bot, el catálogo, los mensajes y
el prompt de la IA, y ver métricas.

**Objetivo del rediseño:** que se vea **mucho más tecnológico y moderno** — estética limpia,
profesional, tipo SaaS / dashboard moderno. Hoy se ve básico y anticuado. Queremos una
identidad visual coherente en todas las páginas, buena jerarquía, microinteracciones sutiles,
modo claro pulido (opcionalmente soporte de modo oscuro). Debe seguir siendo **muy usable**
para asesores que lo usan a diario, no solo bonito.

---

## Restricciones técnicas OBLIGATORIAS (entorno: Google Apps Script Web App)

Todo el front corre servido por `HtmlService` de Google Apps Script. Respeta esto SIEMPRE:

1. **Cada página es un archivo HTML independiente.** Todo su CSS va en `<style>` y su JS en
   `<script>` dentro del mismo archivo. No archivos .css/.js sueltos que se linkeen.
2. **CERO librerías externas por CDN** (ni Tailwind, ni Bootstrap, ni React/Vue, ni jQuery,
   ni Google Fonts remoto, ni Font Awesome). La Content Security Policy de Apps Script las
   bloquea. Usa **CSS puro** y **JavaScript vanilla**. Íconos: emojis o **SVG inline**.
   Tipografía: usa font stacks del sistema (system-ui, -apple-system, Segoe UI, Roboto...).
3. **El backend NO se llama con fetch/AJAX.** Se llama con la API de Apps Script:
   ```js
   google.script.run
     .withSuccessHandler(function(datos){ /* pintar */ })
     .withFailureHandler(function(err){ /* mostrar error */ })
     .nombreDeLaFuncion(args);
   ```
   Es asíncrono por callbacks (NO devuelve Promise). No uses async/await sobre esto.
4. **Estilos y navegación compartidos por includes.** Cada página empieza con:
   ```html
   <!DOCTYPE html><html><head><base target="_top">
     <?!= include('styles') ?>
   </head><body>
     <?!= include('nav') ?>
     ... contenido de la página ...
   </body></html>
   ```
   - `styles` es una hoja de estilos base COMPARTIDA por todas las páginas (aquí van las
     clases comunes: botones, cards, tablas, badges, nav, etc.).
   - `nav` es la barra de navegación superior compartida.
   Diseña esos dos como piezas reutilizables y que las páginas las consuman.
5. **Seguridad — CRÍTICO:** gran parte del contenido proviene de usuarios de WhatsApp o del
   Google Sheet (no confiable). NUNCA insertes datos con `innerHTML` sin escapar. Provee y
   usa `escHtml()` (para texto) y `escAttr()` (para valores en atributos) en TODAS las
   interpolaciones de datos. Esto aplica a nombres, teléfonos, mensajes, textos del catálogo,
   prompts, etc.
6. **No dependas de `localStorage`/`sessionStorage`** para lógica de seguridad (a veces
   bloqueado en el iframe). Solo para cosas cosméticas como el nombre a mostrar.
7. **Navegación entre páginas:** se hace con `?page=<nombre>` sobre la URL base. Para obtener
   la URL base hay una función `getBaseUrl()`. El `nav` actual navega así:
   ```js
   window.top.location.href = _baseUrl + '?page=' + page;
   ```

---

## Identidad visual deseada

- Estética **moderna y tecnológica**: limpia, aireada, con buen uso de espaciado, esquinas
  redondeadas suaves, sombras sutiles, transiciones cortas. Tipo panel SaaS 2025.
- Paleta actual (puedes evolucionarla, manteniendo coherencia): fondo `#f5f7fa`, texto
  `#1a1a2e`, azul primario `#4a90d9` / `#2c5cc5`, verde `#27ae60` / WhatsApp `#25D366`,
  rojo `#e74c3c`, amarillo/naranja `#f39c12`. Nav oscuro `#1a1a2e`.
- Marca: "Cloud Academy" / "Nova" (el bot). Logo actual es un emoji 🤖 / 🎓. Puedes proponer un
  wordmark simple en SVG.
- Coherencia total entre páginas: mismos botones, cards, inputs, badges, encabezados.
- Deseable: estados vacíos amables, loaders/skeletons en vez de "Cargando..." plano, toasts
  para feedback (ya se usa un patrón de toast en una página).

---

## PÁGINAS A REDISEÑAR (todas)

El panel tiene estas páginas. Debes rediseñar **todas** manteniendo su funcionalidad. Abajo
el detalle exhaustivo de cada una: qué muestra, qué controles tiene, y qué funciones de
backend llama.

### Componentes compartidos

**`nav` (barra superior, en todas las páginas salvo login/sin_acceso):**
- Logo/marca "Cloud Academy Panel" a la izquierda.
- Enlaces (llaman a `navegar('<page>')`): **Leads** (page=dashboard), **Embudo** (page=embudo),
  **Prompt** (page=prompt), **Catálogo** (page=catalogo), **Flujo** (page=flujo),
  **Chat** (page=chat).
- A la derecha: nombre del usuario logueado (`#nav-user`).
- Marca el enlace activo según la página actual (usa `google.script.url.getLocation`).
- Debe ser responsive (colapsar/adaptar en móvil).

**`styles` (hoja base compartida):** define las clases comunes. Hoy incluye: `.container`,
`.nav`, `.card`, tablas (`table/th/td`), inputs/textarea/select, botones (`.btn`,
`.btn-primary`, `.btn-sm`, `.btn-success`, `.btn-danger`), login (`.login-box`...), chat
(`.chat-container`, `.chat-list`, `.chat-item*`, `.chat-main`, `.chat-messages`, `.msg`,
`.msg-lead`, `.msg-bot`, `.msg-time`, `.msg-buttons`, `.msg-btn-visual`, `.msg-list*`,
`.msg-image`, `.chat-input`), badges (`.badge`, `.badge-green/blue/yellow/red`), y media
queries responsive. Reléelas y modernízalas.

---

### 1. `login` (page implícita / entrada)
- Pantalla centrada con caja. Título "Cloud Academy Bot", subtítulo "Panel de Administración".
- Al cargar llama a `obtenerUsuarioActual()`. Si `res.success`, guarda `res.nombre`/`res.email`
  (solo cosmético) y redirige a `?page=dashboard`. Si no, muestra el error.
- Nota: "Solo cuentas @example.com y usuarios autorizados". No hay formulario de usuario/clave
  (la auth es por sesión Google). Diseña una landing de acceso elegante con estado de carga.

### 2. `sin_acceso`
- Pantalla de error de acceso. Muestra un mensaje de error (`<?= error ?>`, viene del servidor)
  y "Contacta al administrador". Diseño simple y claro.

### 3. `dashboard` (etiqueta de nav: "Leads")
- Tabla de leads con filtros. Es la vista principal de monitoreo.
- **Filtros** (arriba): Tecnología (`#filter-tech`, onchange `onTechChange()`), Provider
  (`#filter-provider`), Desde/Hasta (inputs date). Por defecto últimos 3 días.
- Llama a `getTecnologiasYProviders()` para poblar los selects encadenados (tech → providers).
- Llama a `getLeads({desde, hasta, provider, orden})` para la tabla.
- **Columnas de la tabla:** Teléfono, Provider, Curso, Estado (badge de color por estado),
  Turnos IA, IA (badge On/Off), Último mensaje, Acciones (botón "Chat" que navega a
  `?page=chat&tel=<telefono>`).
- Badges de estado por color: CONFIRMO → verde, NO_E_* → amarillo, resto → azul.
- Modernizar: convertir en un dashboard con tarjetas de resumen arriba (opcional) + tabla
  filtrable con mejor diseño, paginación o scroll, estados vacíos.

### 4. `embudo` (nav: "Embudo") — página nueva, ya existe
- Dashboard de embudo por estados del bot. Muestra cuántos leads hay en cada estado, en
  cantidad y porcentaje, filtrable por fecha y provider.
- **Filtros:** Provider, "Fecha por" (última actividad / primera interacción), Desde/Hasta,
  botones rápidos "7 días" / "30 días".
- **Tarjetas resumen:** total de leads, cuántos confirmaron/reconfirmaron, tasa de agendamiento %.
- **Tabla/gráfico de embudo:** por cada estado → etiqueta legible + barra de distribución
  (color por tipo: azul en flujo, naranja link enviado, verde agendó, rojo perdido) +
  cantidad + porcentaje.
- Llama a `getEmbudoEstados({desde, hasta, provider, orden})` y `getTecnologiasYProviders()`.
- `getEmbudoEstados` devuelve `{ total, desde, hasta, estados: [{id, label, cantidad, porcentaje}] }`.
- Modernizar: se puede convertir en un embudo visual bonito (funnel) o barras horizontales
  con animación. Mantener cantidad + porcentaje visibles.

### 5. `chat` (nav: "Chat") — LA MÁS IMPORTANTE, la que peor se ve hoy
Bandeja tipo WhatsApp Web / CRM. Dos columnas: lista de conversaciones (izq) + conversación (der).

**Columna izquierda (lista):**
- Barra de filtros: Tecnología, Provider, "Ordenar por" (toggle: Última interacción / Primer
  mensaje), Desde/Hasta, y buscador por teléfono (`#search-leads`, filtra local).
- Lista de items. Cada item (dato de `getLeads`):
  - Teléfono con "+" (dejar lugar para nombre a futuro).
  - **Último mensaje real** (preview 1 línea, truncado) con ícono según origen: cliente sin
    ícono, bot 🤖, IA 🧠, asesor 👤. Si vacío: "Aún sin conversación".
    Datos: `ULTIMO_MSG`, `ULTIMO_MSG_ORIGEN`, `ULTIMO_MSG_TS`.
  - **Hora** del último mensaje (hoy: HH:MM; otro día: DD/MM).
  - Línea pequeña: `ESTADO_BOT · PROVIDER`.
  - Indicador de **modo**: manual / bot / bot+IA (derivar de `BOT_ACTIVO` y `IA_ACTIVA`:
    !bot_activo → manual; bot_activo && !ia_activa → bot; ambos → bot+IA).
  - Item seleccionado resaltado. Ordenar por más reciente arriba. Deseable: badge de no leído.
- Refresco (polling) de la lista cada ~10s.

**Columna derecha (conversación):**
- Header: teléfono + estado + provider, y un **control de MODO triple** (slider 3 posiciones:
  Humano/Manual · Bot · Bot+IA). Al cambiarlo llama `cambiarModoLead(telefono, botActivo, iaActiva)`.
  (Manual = bot off; Bot = bot on / ia off; Bot+IA = ambos on.)
- Área de mensajes tipo chat: **perspectiva de la EMPRESA** →
  - Cliente (origen "lead"/"cliente") a la **IZQUIERDA**, burbuja blanca.
  - Bot / IA / asesor a la **DERECHA**, burbuja verde. Diferenciar con etiqueta: 🤖 Bot /
    🧠 IA / 👤 Asesor.
  - Formato WhatsApp: `*negrita*` → negrita, `_cursiva_` → cursiva, saltos de línea.
  - Soporta media: contenido puede venir como `gcs://ruta|nombre`, `drive://id|clave`, o
    etiquetas `[Imagen]`/`[Video]`/`[Documento]`. Para gcs se pide una URL firmada con
    `getSignedUrl(path)` para mostrar la miniatura; para drive se usa
    `https://drive.google.com/thumbnail?id=<id>&sz=w300`. Mostrar miniatura clickeable.
  - Botones/listas del bot vienen embebidos en el texto como `[Botones: A | B]` y
    `[Lista: X | Y]` — renderízalos como chips/lista visual.
  - Autoscroll al fondo al abrir; si el usuario sube, mostrar badge "⬇ Nuevo mensaje".
- Caja de entrada: input de texto (Enter envía) + botón enviar → `enviarMensajeManual(tel, texto)`.
  Botón adjuntar 📎 (acepta image/*, video mp4/3gpp, pdf, doc/docx) → lee el archivo como
  base64 y llama `enviarArchivoManual(telefono, base64Data, mimeType, fileName)` (máx 2MB).
- Traducción de IDs de botón a texto legible con `getTraduccionesPayload()` (mapa
  {"btn_CLOUD":"CLOUD ☁️", "cert_CLF":"Cloud Practitioner", ...}).
- Refresco de la conversación abierta cada ~5s.
- Responsive: en móvil, al abrir un chat se oculta la lista (pantalla completa) con botón
  "← Volver".

### 6. `prompt` (nav: "Prompt")
- Editor del prompt de la IA con versionado y rollout gradual.
- Textarea grande para el prompt + input numérico "% Rollout (0-100)" + botón "Guardar nueva
  versión" → `guardarNuevoPrompt(texto, rolloutPct)`.
- Lista de versiones (`getAllPrompts()` → [{fila, version, prompt, rollout, fecha}]): cada una
  con su versión, badge de % rollout, fecha, preview del texto, botón "Editar" (carga en el
  textarea) y "Eliminar" (`eliminarPrompt(fila)`, con confirmación).
- Explicar en UI que el rollout gradual aplica el prompt a un % de leads.

### 7. `catalogo` (nav: "Catálogo")
- CRUD del catálogo en **3 pestañas**: Asesores, Cursos, Modalidades.
- Cada pestaña: toolbar con título + botón "+ Agregar", y una tabla tipo Excel con las
  columnas dinámicas de esa hoja + columna de acciones (Editar ✏️ / Eliminar 🗑).
- Los headers y filas son **dinámicos** (vienen del sheet). No asumas columnas fijas.
- Datos: `getCatalogoData(seccion)` → `{ headers: [...], rows: [[...], ...] }` con
  seccion ∈ {"asesores","cursos","modalidades"}.
- Editar/Agregar abre un **modal** con un campo por cada header (input o textarea si el valor
  es largo/multilínea; CERT_ID en modalidades es readonly). Guardar → `guardarCatalogoData({
  seccion, headers, rows })` (reemplaza toda la sección). Eliminar quita la fila y también
  guarda con la misma función. Feedback con toast.

### 8. `flujo` (nav: "Flujo") — la más compleja
- Editor visual del flujo conversacional del bot (los "pasos" del embudo). Cada paso es un
  estado con: nombre amigable, tipo de mensaje (Texto / Botones / Lista), texto del mensaje
  (clave o texto directo), media asociada, opciones (botones/lista) y seguimientos temporizados.
- Encabezado con botones: "+ Nuevo paso" (`agregarPaso()`) y "Guardar todo" (`guardarFlujo()`).
- **Lista de pasos** (acordeón): cada paso muestra su orden (#), nombre, tipo, y al expandir:
  - Campos editables: nombre amigable, tipo_mensaje, mensaje, media.
  - **Opciones**: pueden venir del **catálogo** (autogeneradas, ej. tecnologías/providers/certs
    — readonly, con toggle 👁️ para ocultar/mostrar y contador de caracteres con límite 20
    botones / 24 lista) o ser **opciones libres** (texto del botón editable + selector "Lleva a"
    qué estado siguiente + eliminar ✕). Botón para agregar opción.
  - **Seguimientos** ("si no responde"): lista de mensajes temporizados (tiempo, clave de
    mensaje, media, estado_destino). Botón "+ Seguimiento".
  - Estado del paso: Activo / Inactivo (select).
  - Acciones del paso: mover ↑/↓ (reordenar), Eliminar.
- **Disparadores** (sección aparte): palabras clave que disparan un mensaje automático en
  cualquier punto (ej. "precio"). Lista editable + "+ Agregar disparador" + "Guardar
  disparadores" (`guardarDisparadores(...)`).
- Datos: `getFlujoConMensajes()` → `{ flujo:[...pasos], mensajes:{clave:texto},
  opcionesDinamicas:{...}, disparadores:[...] }`. Guardar: `guardarFlujoCompleto(flujo)` y
  `guardarMensajesSistema(datos)`.
- Es una pantalla densa: el reto de diseño es hacerla clara y ordenada (jerarquía, agrupación,
  colapsables, ayudas visuales) sin perder funcionalidad.

---

## Índice de funciones de backend (nombres EXACTOS — úsalos tal cual)

- `getBaseUrl()` → string (URL base del panel)
- `obtenerUsuarioActual()` → `{ success, email, rol, nombre }` o `{ success:false, error }`
- `getTecnologiasYProviders()` → mapa `{ TECH: [PROVIDER, ...] }`
- `getLeads(filtros)` → `[ lead ]` (ver campos abajo)
- `getEmbudoEstados(filtros)` → `{ total, desde, hasta, estados:[{id,label,cantidad,porcentaje}] }`
- `getConversacion(telefono)` → `{ telefono, mensajes:[{timestamp,origen,tipo,contenido}] }`
- `enviarMensajeManual(telefono, texto)` → `{ success, error? }`
- `enviarArchivoManual(telefono, base64Data, mimeType, fileName)` → `{ success, error? }`
- `getSignedUrl(path)` → string (URL firmada de un objeto en storage)
- `getTraduccionesPayload()` → mapa `{ idBoton: textoLegible }`
- `cambiarModoLead(telefono, botActivo, iaActiva)` → `{ success }`
- `toggleIALead(telefono, activa)` / `toggleBotLead(telefono, activo)` → `{ success }`
- `getMensajes()` → `[ {fila, clave, texto} ]`  |  `updateMensaje(fila, texto)` → `{ success }`
- `getAllPrompts()` → `[ {fila, version, prompt, rollout, fecha} ]`
- `getPromptActual()` → `{ prompt, version, rollout }`
- `guardarNuevoPrompt(texto, rolloutPct)` → `{ success, version }`  |  `eliminarPrompt(fila)` → `{ success }`
- `getCatalogoData(seccion)` → `{ headers, rows }`  |  `guardarCatalogoData({seccion,headers,rows})` → `{ success, error? }`
- `getFlujoConMensajes()` → `{ flujo, mensajes, opcionesDinamicas, disparadores }`
- `guardarFlujoCompleto(flujo)` → `{ success, error? }`  |  `guardarMensajesSistema(datos)` → `{ success }`
- `getDisparadores()` → `[...]`  |  `guardarDisparadores(disparadores)` → `{ success }`

### Campos de un objeto `lead` (todos string)
`TELF`, `PROVIDER`, `CURSO`, `ESTADO_BOT`, `IA_ACTIVA` ("1"/"0"), `BOT_ACTIVO` ("1"/"0"),
`TURNOS_IA`, `ULTIMO_MSG`, `ULTIMO_MSG_ORIGEN` (lead|bot|ia|asesor), `ULTIMO_MSG_TS` (ms),
`CREATED_AT`, `UPDATED_AT`.

### Estados del bot (para badges/colores)
| Estado | Significado | Color |
|---|---|---|
| INICIO | recién entró / eligiendo tecnología | azul |
| NO_E_NUBE | eligiendo proveedor cloud | azul |
| NO_E_CERT | eligiendo certificación | azul |
| NO_E_URGENCIA | eligiendo tiempo | azul |
| NO_CONFIRMO_MEET | recibió link, no confirmó | naranja |
| CONFIRMO_MEET | confirmó agendamiento | verde |
| RECONFIRMO_MEET | reconfirmó asistencia | verde |
| MAS_DE_60_DIAS | 60 días a más | gris |
| REMARKETING_FALLIDO | no respondió / perdido | rojo |

---

## Qué entregar

- Archivos HTML autocontenidos, uno por página: `styles` (base compartida), `nav`,
  `login`, `sin_acceso`, `dashboard`, `embudo`, `chat`, `prompt`, `catalogo`, `flujo`.
  (Puedes empezar por `styles` + `nav` + `chat` + `dashboard` + `embudo` y seguir con el resto,
  o entregar todo junto — como prefieras, pero mantén la coherencia visual entre todos.)
- CSS moderno y coherente, JS vanilla, todo el contenido de datos escapado con `escHtml`/`escAttr`.
- Usa los nombres de función de backend EXACTOS. Puedes mockear datos para previsualizar.
- Al final, lista qué decisiones de diseño tomaste, qué asumiste y qué quedó pendiente.

## Cómo trabajaremos
Tú (Claude Desktop) generas el HTML/CSS/JS. Luego yo (el ingeniero) reviso cada archivo,
verifico compatibilidad con Apps Script y seguridad (escapado/XSS), lo adapto al patrón de
includes del proyecto y lo empalmo/subo. No necesitas preocuparte por el despliegue.
