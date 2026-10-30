# WhatsApp Bots — Google Apps Script

Dos bots de WhatsApp construidos sobre **Google Apps Script** y la **Meta WhatsApp
Cloud API**, con Google Sheets como backend de datos. Son proyectos reales de
producción, adaptados para portafolio: todas las credenciales, IDs, correos,
teléfonos y datos de ejemplo se reemplazaron por placeholders.

## Bots

### [`sales-ai-bot/`](sales-ai-bot) — Automatización de leads
Bot de ventas conversacional con motor de IA para texto libre y un flujo guiado
(proveedor cloud → certificación → urgencia → agendamiento). Integra WhatsApp,
Google Sheets y Google Calendar, persiste media en Cloud Storage e incluye un
**panel de administración web** (dashboard de embudo, chat en vivo, kanban y
editor de flujo). Agenda asesorías automáticamente creando eventos de Calendar y
enviando confirmaciones por WhatsApp.

**Stack:** Apps Script · Meta WhatsApp API · Google Sheets · Google Calendar ·
Google Cloud Storage · HTML/JS (panel).

### [`academic-support-bot/`](academic-support-bot) — Soporte académico
Bot de soporte con flujo **100% por menú numerado** (sin IA). Identifica al
usuario (alumno o docente) consultando un CRM en Google Sheets y le muestra un
menú según su rol: consulta de cursos, secciones, enlaces, material en Drive y
derivación a un humano por correo. Las sesiones se mantienen con
`PropertiesService`.

**Stack:** Apps Script · Meta WhatsApp API · Google Sheets (CRM).

## Conceptos comunes

- **Despliegue con `clasp`.** Cada bot (y cada subproyecto) es un despliegue de
  Apps Script independiente con su propio `scriptId`.
- **Credenciales fuera del código.** Se usan `Script Properties` y un `config.gs`
  local (excluido del repo). Ver `ConfigTemplate.gs` en cada proyecto.
- **Webhook de Meta.** Verificación por `doGet` con un verify token; recepción de
  mensajes por `doPost`.

## Seguridad / sanitización

Este repositorio es una copia de portafolio. Se eliminaron o reemplazaron por
placeholders: IDs de Google Sheets/Drive/Calendar, tokens de Meta, verify tokens,
bucket de Cloud Storage, correos, teléfonos, nombres de personas, dominios de
marca y logos embebidos. Los archivos `config.gs`, `.clasp.json` y `.clasprc.json`
reales no se incluyen (ver `.gitignore`). Para desplegar, copia
`.clasp.json.example` a `.clasp.json` y completa tu `scriptId`.

## Estructura

```
whatsapp-bots-apps-script/
├── README.md
├── .gitignore
├── .clasp.json.example
├── sales-ai-bot/            # bot de ventas + panel admin
└── academic-support-bot/    # bot de soporte académico
```
