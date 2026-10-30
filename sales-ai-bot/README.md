# Sales AI Bot — Automatización de Leads por WhatsApp

Bot de ventas conversacional sobre **Google Apps Script** que integra la
**Meta WhatsApp API**, **Google Sheets** y **Google Calendar** para gestionar el
ciclo completo de un lead: desde la primera interacción hasta el agendamiento de
una asesoría. Incluye un panel de administración web (carpeta `FRONT/`).

> Proyecto de portafolio. Todas las credenciales, IDs y datos de ejemplo han sido
> reemplazados por placeholders (`YOUR_SHEET_ID`, `YOUR_CALENDAR_ID`,
> `YOUR_VERIFY_TOKEN`, `advisor1@example.com`, etc.).

---

## Estructura

```
sales-ai-bot/
├── Code.gs               # Flujo 1 — trigger onChange → Calendar + confirmación WhatsApp
├── ConfigTemplate.gs     # Plantilla de config (copiar como config.gs, fuera del repo)
├── appsscript.json       # Manifiesto del script principal
│
├── bot/                  # Flujo 2 — bot conversacional (proyecto clasp independiente)
│   ├── Bot.gs            # Webhook doPost + motor de flujo + seguimientos
│   ├── MotorIA.gs        # Motor de IA para texto libre
│   ├── Agendamiento.gs   # WhatsApp Flow de reserva de citas
│   ├── NotificacionesCalendar.gs / Recordatorios.gs
│   ├── CloudStorage.gs   # Subida de media a Google Cloud Storage
│   ├── Metricas.gs / ReporteDiario.gs / Pauta.gs / Roles.gs / ...
│   ├── ConfigTemplate.gs # Referencia de Script Properties del bot
│   └── appsscript.json
│
├── FRONT/                # Panel de administración web (proyecto clasp independiente)
│   ├── Main.gs           # Backend del panel (API server-side)
│   └── *.html            # Vistas: dashboard, chat, kanban, flujo, catálogo, etc.
│
└── docs/                 # Documentación y diagramas
    ├── SETUP.md · FLUJO_BOT.md · SEGUIMIENTOS.md · RESUMEN_COMERCIAL_FLUJO.md
    └── *.drawio
```

El proyecto se compone de tres despliegues de Apps Script independientes (raíz,
`bot/` y `FRONT/`), cada uno con su propio `scriptId`.

---

## Componentes

### Flujo 1 — Script principal (`Code.gs`)
- Trigger `onChange` sobre la hoja **Leads**.
- Detecta filas con `estado_agenda = "pendiente"` y datos completos.
- Asigna asesor según `PROVIDER`.
- Crea evento en Google Calendar con invitados (lead + asesor).
- Envía confirmación por WhatsApp con una plantilla de mensaje.

### Flujo 2 — Bot conversacional (`bot/`)
- Webhook `doPost` que recibe mensajes de WhatsApp vía Meta API.
- Flujo data-driven (editable desde una hoja): provider → certificación → urgencia → agendamiento.
- Motor de IA para mensajes de texto libre.
- Seguimientos automáticos por tiempo según el estado del lead.
- Envío de imágenes y video; media persistida en Cloud Storage.

### Panel de administración (`FRONT/`)
- Dashboard de embudo, chat en vivo, kanban de leads, editor de flujo y catálogo.
- Backend server-side en `Main.gs` consumido por las vistas HTML.

---

## Setup

```bash
# 1. Autenticar clasp
clasp login

# 2. Crear el config local a partir de la plantilla (queda fuera del repo)
cp ConfigTemplate.gs config.gs
# Edita config.gs con tus IDs reales

# 3. Clona tu .clasp.json desde el ejemplo de la raíz del repo
cp ../.clasp.json.example .clasp.json
# Edita scriptId con el ID de tu proyecto de Apps Script

# 4. Subir código (push NO cambia la URL del Web App)
clasp push                 # script principal
cd bot && clasp push       # bot
cd ../FRONT && clasp push  # panel
```

Ver [`docs/SETUP.md`](docs/SETUP.md) para triggers, hojas y configuración del webhook de Meta.

> El bot conversacional lee sus credenciales desde **Script Properties**
> (`ACCESS_TOKEN`, `PHONE_NUMBER_ID`, `DEEPSEEK_API_KEY`, `DATA_SHEET_ID`, ...),
> no desde el código.

---

## Datos sensibles

Nunca se versionan (ver `.gitignore` en la raíz del repo):
- `config.gs` con IDs de Sheets/Calendar.
- Access Token / Phone Number ID de Meta (en Script Properties).
- Verify Token del webhook.
- Service account key de Google Cloud Storage (en Script Properties).

Usa `ConfigTemplate.gs` como referencia para crear tu `config.gs`.

---

## Documentación

| Archivo | Contenido |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | Guía de instalación y configuración |
| [`docs/FLUJO_BOT.md`](docs/FLUJO_BOT.md) | Estados, IDs de botones y columnas del sheet |
| [`docs/SEGUIMIENTOS.md`](docs/SEGUIMIENTOS.md) | Seguimientos automáticos por estado y tiempo |
| [`docs/RESUMEN_COMERCIAL_FLUJO.md`](docs/RESUMEN_COMERCIAL_FLUJO.md) | Resumen del flujo comercial |
