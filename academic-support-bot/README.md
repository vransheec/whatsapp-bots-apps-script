# Cloud Academy Academic Bot v2

Bot de WhatsApp para soporte académico de Cloud Academy. Flujo 100% por menú numerado (sin IA), desplegado como Google Apps Script.

## Arquitectura

| Archivo | Descripción |
|---------|-------------|
| `Code.gs` | Webhook principal (doGet, doPost), flujo de conversación y navegación del menú |
| `SheetsModule.gs` | Lectura de configuración, menú (árbol de nodos), variables y log |
| `WhatsAppModule.gs` | Envío de mensajes via Meta WhatsApp API (texto, botones, listas, CTA) |
| `CRMModule.gs` | Búsqueda de alumnos/docentes, matrículas y secciones en el CRM |
| `SessionModule.gs` | Manejo de sesiones de conversación (PropertiesService) |
| `SetupModule.gs` | Script de setup para crear la hoja MENU con todos los nodos |

## Flujo del bot

```
1. Usuario escribe → doPost recibe el mensaje
2. Se verifica/crea la sesión (PropertiesService, expira a 4h)
3. Si no hay audiencia → pregunta si es alumno o docente (botones)
4. Busca al usuario en el CRM por número de teléfono
5. Muestra menú principal numerado según su rol (ALUMNO_ROOT o DOCENTE_ROOT)
6. El usuario navega con números (1-9), vuelve con "0", reinicia con "menu"
7. Los nodos hoja ejecutan acciones: TEXTO, CRM_CONSULTA, ENLACE, DRIVE, DERIVAR
8. DERIVAR captura la descripción del problema y envía email al área académica
```

### Selección de curso/sección (multi-matrícula)

Cuando el usuario entra a "Mi Curso" (alumno) o "Mi Clase" (docente) y tiene más de
una sección, el bot pregunta por cuál consulta. El flujo (igual para alumno y
docente) es:

```
Curso  →  Sección
```

- **Curso:** los cursos se muestran en una sola lista **agrupada por provider**
  (AWS, GCP, AZURE, etc., leído de la columna `Provider` del CRM), con encabezado
  por provider y numeración corrida. Si solo hay un curso, este paso se salta.
- **Sección:** las secciones se listan **agrupadas por estado** (🟢 En progreso,
  📅 Programadas, ✅ Finalizadas). El estado se lee de la columna `Estado` de la
  hoja Secciones del CRM. Las secciones `Cancelada` no se muestran.
- Con "0" se retrocede paso a paso (sección → curso → menú).
- El alumno ve también las finalizadas (para material/grabaciones); el docente solo
  ve las vigentes (no finalizadas).

## Configuración

### Script Properties (datos sensibles)

Se configuran manualmente desde Apps Script → ⚙️ Configuración del proyecto → Propiedades del script.

| CLAVE | DESCRIPCIÓN |
|-------|-------------|
| BOT_SHEET_ID | ID del Google Sheet del bot (config + menú + log) |
| WHATSAPP_PHONE_NUMBER_ID | ID del número en Meta |
| WHATSAPP_ACCESS_TOKEN | Token de acceso de Meta |
| WHATSAPP_VERIFY_TOKEN | Token para verificar webhook |
| CRM_SHEET_ID | ID del Google Sheet del CRM |
| EMAIL_ACADEMICO | Email para notificaciones de derivación |
| DEBUG_NUMEROS | Números autorizados para debug (separados por coma) |

### Hoja CONFIGURACION (mensajes editables)

Estos valores viven en el Google Sheet y el equipo académico puede editarlos sin tocar código.

| CLAVE | DESCRIPCIÓN |
|-------|-------------|
| NOMBRE_BOT | Nombre del bot |
| MENSAJE_BIENVENIDA | Primer mensaje al usuario |
| MENSAJE_DERIVAR | Mensaje cuando se deriva a humano |
| MENSAJE_NO_REGISTRADO | Mensaje cuando el usuario no está en el CRM |
| MENSAJE_NO_ENTENDIDO | Mensaje cuando el tipo de mensaje no es texto |
| MENSAJE_INSTRUCCION_MENU | Instrucción mostrada debajo de cada menú |
| MENSAJE_SELECCIONAR_CURSO | Texto para selección de curso (agrupada por provider, alumno) |
| MENSAJE_SELECCIONAR_CURSO_DOCENTE | Texto para selección de curso (docente) |
| MENSAJE_SELECCIONAR_SECCION | Texto para selección de sección (agrupada por estado) |
| MENSAJE_OPCION_INVALIDA_SECCION | Mensaje ante número inválido al elegir sección |
| MENSAJE_DERIVACION_CONFIRMADA | Confirmación tras recibir descripción del problema |
| SIMULADOR_URL | URL del simulador de práctica |

## Hoja MENU - Headers

```
ID | PADRE | AUDIENCIA | NIVEL | TITULO_OPCION | TIPO_NODO | TIPO_ACCION |
PARAMETRO_ACCION | TEXTO_RESPUESTA | TIPO_ADJUNTO | URL_ADJUNTO |
TEXTO_BOTON_URL | ACTIVO | ORDEN
```

## Hoja CRM (Sheet separado)

- **Alumnos:** ID, Nombre, Email, Teléfono, País
- **Docentes:** ID, Nombre, Email, Teléfono, País, Certificaciones, Cursos
- **Matriculas:** ID, AlumnoID, Sección, PrecioTotal, ..., EstadoMatricula, SaldoPendiente, Modalidad
- **Secciones** (índices que consume el bot):

  | Índice | Columna | Uso en el bot |
  |--------|---------|---------------|
  | 0 | Codigo | Código de la sección |
  | 1 | NombreCurso | Nombre del curso mostrado |
  | 3 | Provider | Agrupación por provider (paso previo del docente) |
  | 5 | DocenteID | Filtro de secciones que dicta el docente |
  | 6 | DocenteNombre | Nombre del docente de la sección |
  | 10 | Frecuencia | Frecuencia mostrada |
  | 12 | **Estado** | Estado de la sección: `Programada`, `En Curso`, `Finalizada`, `Cancelada` |
  | 13 | FechaInicio | Fecha de inicio mostrada |
  | 14 | FechaFin | Fecha de fin |
  | 18 | DriveFolderId | Enlace a la carpeta de Drive |
  | 20 | CalendarEventId | Evento de Calendar (Meet / próxima clase) |
  | 21 | ClassroomId | Enlace a Classroom |

  > El estado de cada sección se **lee de la columna `Estado` (índice 12)**, no se
  > calcula por fechas. El bot lo normaliza así: `En Curso` → En progreso,
  > `Programada` → Programada, `Finalizada` → Finalizada, `Cancelada` → se oculta.
  > El esquema completo de la hoja lo escribe y documenta el proyecto CRM.

## Setup

1. Ir a script.google.com → Nuevo proyecto
2. Crear un archivo .gs por cada módulo
3. Ejecutar `crearHojaMenu()` una vez para poblar la hoja MENU
4. Implementar → Nueva implementación → Aplicación web
   - Ejecutar como: Yo
   - Quién tiene acceso: Cualquier usuario
5. Copiar la URL generada y configurar en Meta Developers → Webhooks

## Utilidades

Desde el editor de Apps Script:
- `verProperties()` → muestra las Script Properties configuradas

Para reiniciar la sesión de un usuario, este puede escribir `reset` en el chat.

## Setup inicial (ejecutar una vez)

- `crearHojaMenu()` → crea la hoja MENU con todos los nodos del bot
- `crearHojaSesiones()` → crea la hoja SESIONES para almacenar conversaciones activas
- `actualizarHojaLog()` → crea/verifica la hoja LOG_CONVERSACIONES con el formato actualizado

## Notas importantes

- El Access Token de Meta vence cada 24h en modo desarrollo
- En producción usar un System User Token permanente
- Las sesiones se guardan en la hoja SESIONES (no en Script Properties)
- Si la sesión expira (4h), el usuario conserva su identidad y vuelve al menú principal sin re-identificarse
- El cache de config/menú se refresca cada 5 minutos
- Ejecutar `limpiarSesionesAntiguas()` con un trigger diario para limpiar sesiones de más de 24h
- LOG_CONVERSACIONES registra: fecha, teléfono, audiencia, nombre, nodo actual, nodo acción, tipo, derivado, tiempo
