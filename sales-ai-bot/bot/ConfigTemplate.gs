// ============================================================
// CONFIGURACIÓN — Bot conversacional (Bot.gs)
// Todas las credenciales se leen de PropertiesService (Script Properties)
// ============================================================

// ── Propiedades requeridas en Script Properties ───────────────
// (Editor de Apps Script → ⚙️ Configuración → Propiedades del script)
//
// ACCESS_TOKEN       → Token de Meta WhatsApp API (empieza con EAA...)
// PHONE_NUMBER_ID    → Phone Number ID de Meta (numérico)
// NUMEROS_TEST       → Números para pruebas con IA, separados por coma
//                      Ejemplo: "000000000000,5219991234567"
// TEST_NUMBER        → Número para la función probarDoPost()
// DEEPSEEK_API_KEY   → API key de DeepSeek (para el motor IA)

// ── Constantes hardcodeadas en Bot.gs ─────────────────────────
// VERIFY_TOKEN       → Token de verificación del webhook de Meta
//                      Valor actual: "YOUR_VERIFY_TOKEN"
// DATA_SHEET_ID      → ID del Google Sheet con datos del bot
//                      (DATA_LEADS, Cursos, Asesor, Mensajes, Logs)

// ── Cómo configurar ──────────────────────────────────────────
// 1. Abre tu proyecto en script.google.com
// 2. Ve a ⚙️ Configuración del proyecto (engranaje en barra lateral)
// 3. Baja a "Propiedades del script"
// 4. Agrega cada propiedad con su clave y valor correspondiente
// 5. Guarda
//
// Ventajas vs el sheet de config anterior:
// - Más seguro (no accesible desde el spreadsheet)
// - Más rápido (no abre un sheet en cada request del webhook)
// - Centralizado junto con DEEPSEEK_API_KEY
