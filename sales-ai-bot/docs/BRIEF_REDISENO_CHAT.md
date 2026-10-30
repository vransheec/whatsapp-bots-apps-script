# Brief para rediseño del Chat — Panel Admin Cloud Academy

> Copia este documento completo a Claude Desktop para que diseñe el HTML/CSS/JS del chat.
> El resultado se revisará y se empalmará en Google Apps Script.

## Objetivo

Rediseñar la vista de **Chat** de un panel de administración de un bot de WhatsApp.
Es una bandeja tipo "WhatsApp Web / CRM": a la izquierda la lista de conversaciones
(leads), a la derecha la conversación seleccionada. Hoy se ve pobre y poco práctica.
Queremos una experiencia moderna, clara y usable para asesores comerciales.

## Restricciones técnicas OBLIGATORIAS (entorno: Google Apps Script Web App)

El HTML corre servido por `HtmlService` de Google Apps Script. Por eso:

1. **Un solo archivo HTML.** Todo el CSS va en un `<style>` y todo el JS en un `<script>`
   dentro del mismo archivo. No uses archivos .css o .js externos.
2. **NADA de librerías externas por CDN** (ni Tailwind, ni Bootstrap, ni React, ni jQuery,
   ni Google Fonts remoto). La Content Security Policy de Apps Script las bloquea.
   Usa **CSS puro** y **JavaScript vanilla**. Puedes usar emojis y SVG inline para íconos.
3. **El backend NO se llama con fetch/AJAX.** Se llama con la API especial de Apps Script:
   ```js
   google.script.run
     .withSuccessHandler(function(datos){ /* pintar */ })
     .withFailureHandler(function(err){ /* mostrar error */ })
     .nombreDeLaFuncion(args);
   ```
   Es asíncrono por callbacks (no devuelve Promise). Trátalo como tal.
4. **No uses `localStorage`/`sessionStorage` para datos críticos** (a veces bloqueado en
   el iframe). Guarda estado en variables JS. (El nombre del usuario ya se lee aparte.)
5. **Seguridad — MUY IMPORTANTE:** el contenido de los mensajes proviene de usuarios de
   WhatsApp (no confiable). NUNCA insertes ese texto con `innerHTML` sin escaparlo.
   Usa una función `escHtml()` (crea un nodo de texto) para todo lo que venga de datos.
   Para valores dentro de atributos usa `escAttr()`.
6. El HTML se incrusta con dos includes al inicio (los mantengo yo al empalmar):
   `<?!= include('styles') ?>` y `<?!= include('nav') ?>`. Puedes asumir que existe una
   hoja de estilos base y una barra de navegación superior; tu diseño va debajo del nav.

## Funciones de backend disponibles (ya existen, así se llaman)

- `getLeads(filtros)` → devuelve un array de leads. `filtros = { desde, hasta, provider, orden }`.
  Cada lead es un objeto con estas propiedades (todas string):
  - `TELF` — teléfono (formato internacional sin +, ej "51999888777")
  - `PROVIDER` — "AWS" | "AZURE" | "GCP" | "" (puede estar vacío)
  - `CURSO` — certificación elegida o ""
  - `ESTADO_BOT` — estado del embudo (ver lista abajo)
  - `IA_ACTIVA` — "1" o "0"
  - `BOT_ACTIVO` — "1" o "0"
  - `TURNOS_IA` — número como string
  - `ULTIMO_MSG` — texto del último mensaje de la conversación (puede venir vacío)
  - `ULTIMO_MSG_ORIGEN` — "lead" (cliente) | "bot" | "ia" | "asesor" | ""
  - `ULTIMO_MSG_TS` — timestamp en milisegundos (número como string) o ""
  - `CREATED_AT`, `UPDATED_AT` — fechas
- `getConversacion(telefono)` → `{ telefono, mensajes: [ { timestamp, origen, tipo, contenido } ] }`
  - `origen`: "lead" | "bot" | "ia" | "asesor" | "sistema"
  - `tipo`: "text" | "interactive" | "image" | "video" | "document" | "boton" | "texto"
  - `contenido`: texto. Para media puede venir como "gcs://ruta|nombre" o "drive://id|clave"
    o etiquetas como "[Imagen]".
- `enviarMensajeManual(telefono, texto)` → `{ success }`. Envía texto por WhatsApp.
- `enviarArchivoManual(telefono, base64Data, mimeType, fileName)` → `{ success }`. Envía media.
- `cambiarModoLead(telefono, botActivo, iaActiva)` → `{ success }`. Cambia el modo del lead.
- `getTraduccionesPayload()` → mapa { "btn_CLOUD": "CLOUD ☁️", "cert_CLF": "Cloud Practitioner", ... }
  para traducir IDs de botones a texto legible.
- `getBaseUrl()` → URL base del panel (para navegación).

## Perspectiva de las burbujas (importante)

Es la vista de la EMPRESA mirando la conversación. Por eso:
- Mensajes del **cliente (origen "lead")** → burbuja a la **IZQUIERDA**, fondo blanco.
- Mensajes del **bot / IA / asesor** → burbuja a la **DERECHA**, fondo verde claro (estilo WhatsApp).
- Diferencia visualmente bot (🤖), IA (🧠) y asesor humano (👤) — por ejemplo con una
  etiqueta pequeña o color de acento distinto en la burbuja derecha.

## Lista de conversaciones (columna izquierda) — qué mostrar por item

- Teléfono (con "+" delante). Si algún día hay nombre, dejar preparado el lugar.
- **Último mensaje real** (preview de una línea, truncado). Con un pequeño prefijo/ícono
  según quién lo envió (cliente sin ícono; bot 🤖; ia 🧠; asesor 👤). Si no hay mensajes,
  mostrar "Aún sin conversación" en gris.
- **Hora** del último mensaje (si es hoy: HH:MM; si es otro día: DD/MM).
- **Estado del bot** y **provider** en una línea pequeña (ej "NO_E_CERT · AWS").
- Indicador del **modo** actual: manual / bot / bot+IA.
- Resaltar el item seleccionado.
- Ordenar por último mensaje más reciente arriba.
- Barra de **búsqueda** por teléfono arriba de la lista.

## Panel de conversación (columna derecha)

- Header con el teléfono del lead + su estado + provider.
- Un **control de modo** (triple: Manual / Bot / Bot+IA) que llama a `cambiarModoLead`.
- Área de mensajes tipo chat (scroll, autoscroll al final al abrir, badge de "nuevos
  mensajes" si el usuario scrolleó hacia arriba).
- Caja de entrada para que el asesor escriba y envíe texto (`enviarMensajeManual`), y un
  botón para adjuntar imagen/archivo (`enviarArchivoManual`, recibe base64).
- Soporte para render de media (imagen) — al menos mostrar una miniatura o un placeholder
  claro "[Imagen]" / "[Video]" / "[Documento]" cuando el contenido no sea texto plano.
- Formato tipo WhatsApp en el texto: `*negrita*` → negrita, saltos de línea respetados.

## Estados del bot (para badges/colores sugeridos)

| Estado | Significado | Color sugerido |
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

## Comportamiento en vivo

- La lista se refresca cada ~10s y la conversación abierta cada ~5s (polling con
  `setInterval` llamando a `getLeads` / `getConversacion`). Diseña pensando en refrescos
  sin parpadeo molesto (evita recrear todo si no cambió, si puedes).

## Responsive

- En móvil: al tocar una conversación, ocultar la lista y mostrar el chat a pantalla
  completa, con un botón "← Volver" para regresar a la lista.

## Qué entregar

Un único archivo HTML autocontenido (`<style>` + markup + `<script>`) con:
- La lista de conversaciones y el panel de chat funcionando con las funciones de backend
  descritas (puedes mockear los datos para previsualizar, pero deja los nombres de función
  exactos para el empalme).
- CSS moderno, limpio, buen uso de espacio, jerarquía visual clara, estados hover/activo.
- Todo el texto de datos escapado con `escHtml`/`escAttr`.

Al final, indícame qué decisiones de diseño tomaste y qué dejaste pendiente.
