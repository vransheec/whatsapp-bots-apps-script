# Resumen comercial del flujo del bot — Cloud Academy

> Documento no técnico. Describe cómo el bot de WhatsApp atiende a un lead desde que
> escribe por primera vez hasta que agenda (o se pierde). Objetivo: evaluar por qué no
> estamos convirtiendo leads.

## Qué es y qué vende

Cloud Academy vende **certificaciones tecnológicas** (nube: AWS, Azure, Google Cloud;
también IA y formación para Empresas). El objetivo del bot NO es vender directamente, sino
**calificar al lead y llevarlo a agendar una asesoría gratuita** con un asesor humano, que
es quien cierra la venta.

La meta de conversión del bot es: **que el lead agende (y luego asista a) la asesoría.**

## El canal

- Todo ocurre por **WhatsApp**. El lead llega desde anuncios/campañas y escribe al número.
- El bot se llama "Nova". Responde con mensajes, imágenes, botones y listas.
- Si el lead escribe texto libre, una IA interpreta la intención y responde; si no logra
  avanzar tras varios intentos, deriva a un asesor humano.

---

## El recorrido del lead (embudo), paso a paso

1. **Primer contacto (saludo).**
   El lead escribe y el bot lo saluda: "¿En qué tecnología buscas certificarte?" y ofrece
   opciones: **CLOUD / IA / Empresas**.

2. **Elige tecnología.**
   - Si elige **CLOUD**, el bot pregunta el proveedor: **AWS / Azure / Google Cloud**
     (con una imagen de apoyo tipo "¿No sabes qué nube elegir?").
   - Si elige IA o Empresas, pasa directo a ver las certificaciones de esa área.

3. **Elige proveedor** (solo para Cloud) → el bot muestra la **lista de certificaciones**
   disponibles de ese proveedor.

4. **Elige certificación** → el bot muestra info/imagen de esa certificación y pregunta
   **para cuándo quiere certificarse**: "2 semanas", "30 días" o "60 días a más".

5. **Según la urgencia:**
   - **2 semanas / 30 días** → el bot le envía el **link para agendar** la asesoría con un
     asesor y le pide confirmar con un botón "Ya agendé".
   - **60 días a más** → se le da un mensaje y queda en un estado de baja prioridad
     (prácticamente fuera del embudo activo).

6. **Agendamiento.**
   El lead recibe el link. Cuando presiona "Ya agendé", el bot **verifica en el calendario**
   si realmente reservó:
   - Si encuentra la cita → confirma "¡Nos vemos ahí!".
   - Si no la encuentra → le insiste en que agende y vuelve a mostrar el botón.

7. **Estados finales:**
   - **Confirmó / reconfirmó** la asesoría → objetivo cumplido (pasa al asesor humano).
   - **No respondió / no agendó / no asistió** → se marca como "remarketing fallido"
     (lead perdido, salvo que el asesor lo reactive).

En cualquier punto, si el lead escribe palabras como "precio", "costo", etc., el bot
responde automáticamente con información de precios (disparador por palabra clave).

---

## Los seguimientos automáticos (recordatorios)

Si el lead se queda sin responder, el bot le envía recordatorios según el tiempo transcurrido.

**Si eligió tecnología/proveedor/certificación pero no siguió:**
- A las **18 horas** → un único recordatorio reofreciendo las opciones de ese paso.

**Si ya recibió el link de agendar pero no confirmó ("No confirmó reunión"):**
- **30 min** → video + recordatorio con el link.
- **1 hora** → imagen + recordatorio.
- **10 horas** → imagen + recordatorio.
- **17 horas** → imagen + recordatorio.
- **23 horas** → mensaje final "de dolor" (última llamada) → si no responde, se da por perdido.

**Si ya confirmó la asesoría:**
- **30 min** → recordatorio para reconfirmar asistencia.
- **15 horas** → mensaje sobre un simulador (valor agregado).
- **22 horas** → mensaje de remarketing (solo si el asesor lo activa manualmente porque no
  asistió) → si no responde, se da por perdido.

---

## Puntos de fricción / posibles causas de baja conversión (para evaluar)

Estos son los puntos donde el embudo puede estar perdiendo leads. Los listamos para que el
análisis se enfoque:

1. **Muchos pasos antes de agendar.** El lead debe elegir tecnología → proveedor →
   certificación → urgencia → recién ahí recibe el link. Son 4-5 interacciones antes de la
   acción de valor. Cada paso es una oportunidad de abandono.

2. **El agendamiento depende de un link externo.** El lead sale de WhatsApp a otra
   plataforma (calendario) para reservar. Ese salto suele tener alta caída.

3. **La confirmación exige doble acción.** Primero agendar en el link, luego volver a
   WhatsApp y tocar "Ya agendé". Si el sistema no encuentra la cita, insiste, lo que puede
   frustrar a quien sí agendó.

4. **La urgencia filtra fuerte.** Quien dice "60 días a más" queda prácticamente descartado
   del embudo, aunque podría ser un lead cultivable a futuro.

5. **Volumen alto de recordatorios en poco tiempo.** Quien recibió el link y no confirmó
   recibe mensajes a los 30 min, 1h, 10h, 17h y 23h. Puede percibirse como insistente y
   generar bloqueos o silencio.

6. **La IA deriva a asesor tras pocos intentos.** Si el lead escribe libremente y la IA no
   logra encaminarlo rápido, se le manda con un asesor — bueno para casos complejos, pero
   puede cortar prematuramente conversaciones que el bot podría resolver.

7. **No hay captura temprana de datos ni de contexto del anuncio.** El bot no personaliza
   según de qué campaña vino el lead ni su nivel/experiencia, así que todos reciben el mismo
   recorrido genérico.

8. **El mensaje de precios es automático por palabra clave.** Si el precio se muestra
   demasiado pronto (antes de construir valor), puede espantar; si no se muestra, frustra.

---

## Preguntas para la evaluación

- ¿En qué paso concreto se cae la mayoría de leads? (esto lo tenemos por estados en el panel)
- ¿El recorrido es demasiado largo para el canal? ¿Se podría acortar el camino al agendamiento?
- ¿La cadencia de recordatorios ayuda o satura?
- ¿Conviene ofrecer valor (contenido, precio con contexto, prueba) antes de pedir agendar?
- ¿El filtro de urgencia descarta leads recuperables?
- ¿El salto a un link externo para agendar es el mayor punto de fuga?

---

### Datos disponibles para respaldar el análisis
En el panel tenemos, por rango de fechas: cuántos leads hay en cada estado del embudo
(cantidad y %), y la tasa de agendamiento. Eso permite ver exactamente dónde se pierden.
