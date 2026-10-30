# ⚠️ Reglas de despliegue — LEER ANTES DE TOCAR

## BOT (carpeta `bot/`) — proyecto del webhook de WhatsApp

### ❌ PROHIBIDO: `clasp deploy` en el bot
Hacer `clasp deploy` sobre el bot **rompe la conexión con Meta**: cambia o
desincroniza la URL del Web App, y Meta deja de entregar los mensajes → el bot
"deja de responder". Esto ya pasó varias veces.

### ✅ PERMITIDO
- **`clasp push`** (sube el código al proyecto; NO toca deployment ni URL). Seguro.

### Cómo se despliega el bot (lo hace el USUARIO desde el editor)
1. Editor de Apps Script del bot → **Implementar → Administrar implementaciones**.
2. Editar (✏️) la implementación **existente** (no crear una nueva).
3. Versión → **Nueva versión** → **Implementar**.
   Esto mantiene la MISMA URL `/exec`, así Meta sigue conectado.

### Si por error se crea un deployment nuevo (URL nueva)
Hay que reconfigurar el webhook en Meta:
- **Callback URL**: la URL `/exec` del deployment activo (Administrar implementaciones).
- **Verify token**: `YOUR_VERIFY_TOKEN` (definido en `Bot.gs` → `VERIFY_TOKEN`).
- Suscribir el campo **`messages`**.
- Un deployment recién creado puede tardar 1-2 min en responder (da 404 mientras propaga).

---

## FRONT (carpeta `FRONT/`) — panel de administración

- `clasp push` + `clasp deploy` son seguros aquí (no depende de Meta).
- El deployment de producción se actualiza con:
  `clasp deploy -i <ID_DEPLOYMENT> -d "descripcion"` (mantiene la misma URL del panel).
