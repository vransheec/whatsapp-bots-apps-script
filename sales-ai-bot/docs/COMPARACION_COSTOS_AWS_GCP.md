# Comparación de Costos: AWS vs GCP — Bot IA Ventas Cloud Academy

## 1. Volumetría Mensual

| Métrica | Valor |
|---|---|
| Conversaciones/día | 40 |
| Conversaciones/mes | 1,200 |
| Llamadas IA por conversación | 4 |
| Llamadas backend por botones (por conv) | 5 |
| Llamadas backend por respuesta a Meta (por turno IA) | 4 |
| **Total llamadas IA/mes** | **4,800** |
| **Total invocaciones backend (webhook)/mes** | **10,800** |
| **Total llamadas salientes a Meta API/mes** | **~13,070** |
| Seguimientos (cron cada 30min) | 1,440 ejecuciones + ~2,190 mensajes Meta |
| Media Refresher (semanal) | 4 ejecuciones + 80 uploads a Meta + 80 lecturas Drive |
| Recordatorios Calendar (diario) | 30 ejecuciones + 300 correos + 30 lecturas Calendar |
| Warmup (cada 5min) | 8,640 invocaciones (keep-alive) |
| **Total invocaciones backend/mes** | **~20,914** |
| Payload promedio respuesta (la más grande) | ~450 bytes |
| Payload promedio request webhook Meta | ~1-2 KB |
| Cache entries por lead (memoria corta IA) | 3 keys × ~4 KB × 6h TTL |
| Leads activos en cache simultáneamente | ~200 |

---

## 2. Mapeo de Componentes Actuales → AWS / GCP

| Componente Actual (Google Workspace) | Función | AWS | GCP |
|---|---|---|---|
| Apps Script (doPost webhook) | Backend / API | **Lambda + API Gateway** | **Cloud Functions + Cloud Endpoints** |
| Apps Script (triggers temporales: 30min, 5min, diario, semanal) | Cron jobs | **EventBridge Scheduler + Lambda** | **Cloud Scheduler + Cloud Functions** |
| Google Sheets (DATA_LEADS, Asesor, Cursos, FAQ, Modalidades, Mensajes) | Base de datos | **DynamoDB** | **Firestore** |
| CacheService (dedup, memoria IA, datos sheets) | Cache en memoria | **ElastiCache (Redis) — o DAX si se usa DynamoDB** | **Memorystore (Redis)** |
| Google Drive (imágenes/videos para Media Refresher) | Storage de archivos | **S3** | **Cloud Storage** |
| DeepSeek API (IA) | Proveedor de inferencia | **DeepSeek API (externo)** — o Bedrock si se migra modelo | **DeepSeek API (externo)** — o Vertex AI si se migra |
| WhatsApp Business API (Meta) | Canal de mensajería | **Meta API (externo, igual en ambos)** | **Meta API (externo, igual en ambos)** |
| Google Calendar (lectura de eventos) | Agenda de asesorías | **Amazon EventBridge + custom integration** o mantener Google Calendar API | **Google Calendar API (nativo)** |
| Gmail (envío de correos recordatorio) | Email transaccional | **SES (Simple Email Service)** | **SendGrid via Marketplace** o Gmail API (nativo) |
| Google Sheets (Logs) | Logging/Observabilidad | **CloudWatch Logs** | **Cloud Logging** |
| Google Sheets (Métricas) | Dashboard de métricas | **CloudWatch Metrics + Dashboard** | **Cloud Monitoring + Dashboard** |
| Frontend de mantenimiento (no existe hoy) | Admin panel | **Amplify + S3 + CloudFront** | **Firebase Hosting** o **Cloud Run (SSR)** |

---

## 3. Arquitectura AWS — Detalle de Componentes

### 3.1 Compute (Backend)
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **API Gateway (REST)** | Recibe webhooks de Meta | 20,914 requests × $3.50/millón = **$0.07** |
| **Lambda** | Procesa mensajes, seguimientos, refresher, recordatorios | 20,914 invocaciones × 512MB × ~2s promedio = **~$0.50** |
| **EventBridge Scheduler** | Triggers: cada 30min, 5min, diario, semanal | 4 reglas = **$0.00** (gratis hasta 14M invocaciones) |

### 3.2 Base de Datos
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **DynamoDB (on-demand)** | DATA_LEADS, Asesor, Cursos, FAQ, Modalidades, Mensajes | ~50K lecturas + ~15K escrituras = **~$1.50** |

### 3.3 Cache
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **ElastiCache Redis (t4g.micro)** | Dedup, memoria IA, cache de datos | 1 nodo = **~$12.00** |

### 3.4 Storage
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **S3** | Imágenes/videos para Media Refresher (~500MB) | **~$0.02** |

### 3.5 Email
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **SES** | 300 correos recordatorio/mes | **$0.03** (primeros 62K gratis si envías desde EC2/Lambda) |

### 3.6 Observabilidad
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **CloudWatch Logs** | Logs de Lambda | ~5GB ingestión = **~$2.50** |
| **CloudWatch Metrics/Dashboard** | Métricas del bot | 1 dashboard + custom metrics = **~$3.00** |

### 3.7 Frontend (Admin Panel)
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Amplify Hosting** | Frontend React/Next.js | **$0.00** (free tier: 5GB) |
| **CloudFront** | CDN para el frontend | **~$0.00** (1,000 requests gratis) |
| **Cognito** | Autenticación del admin panel | 1-5 usuarios = **$0.00** (gratis hasta 50K MAU) |

### 3.8 Extras
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Secrets Manager** | API keys (DeepSeek, Meta token) | 2 secrets = **$0.80** |
| **IAM** | Permisos | **$0.00** |

### **TOTAL AWS estimado: ~$20-22/mes**

---

## 4. Arquitectura GCP — Detalle de Componentes

### 4.1 Compute (Backend)
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Cloud Functions (2nd gen)** | Procesa webhooks, seguimientos, refresher, recordatorios | 20,914 invocaciones × 512MB × ~2s = **~$0.40** |
| **Cloud Endpoints / API Gateway** | Recibe webhooks de Meta | Incluido con Cloud Functions = **$0.00** |
| **Cloud Scheduler** | Triggers: cada 30min, 5min, diario, semanal | 4 jobs = **$0.40** (3 gratis, $0.10/extra) |

### 4.2 Base de Datos
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Firestore (Native mode)** | DATA_LEADS, Asesor, Cursos, FAQ, Modalidades, Mensajes | ~50K lecturas + ~15K escrituras = **~$0.50** |

### 4.3 Cache
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Memorystore (Redis) — Basic M1 (1GB)** | Dedup, memoria IA, cache de datos | **~$35.00** |

### 4.4 Storage
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Cloud Storage (Standard)** | Imágenes/videos (~500MB) | **~$0.02** |

### 4.5 Email
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Gmail API (nativo)** o **SendGrid (free tier)** | 300 correos/mes | **$0.00** (SendGrid free: 100/día) |

### 4.6 Observabilidad
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Cloud Logging** | Logs de funciones | ~5GB = **~$2.50** |
| **Cloud Monitoring + Dashboard** | Métricas del bot | **~$0.00** (primeros 150MB gratis) |

### 4.7 Frontend (Admin Panel)
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Firebase Hosting** | Frontend React/Next.js | **$0.00** (free tier: 10GB transfer) |
| **Firebase Auth** | Autenticación del admin panel | 1-5 usuarios = **$0.00** |

### 4.8 Extras
| Servicio | Uso | Estimación mensual |
|---|---|---|
| **Secret Manager** | API keys (DeepSeek, Meta token) | 2 secrets × 6 accesos = **~$0.01** |
| **IAM** | Permisos | **$0.00** |
| **Google Calendar API** | Lectura de eventos (nativo, sin costo extra) | **$0.00** |

### **TOTAL GCP estimado: ~$39-41/mes**

---

## 5. Comparación Directa

| Categoría | AWS | GCP | Notas |
|---|---|---|---|
| Compute | ~$0.57 | ~$0.80 | Ambos serverless, muy baratos a este volumen |
| Base de datos | ~$1.50 | ~$0.50 | DynamoDB on-demand vs Firestore |
| **Cache (Redis)** | **~$12.00** | **~$35.00** | GCP Memorystore es significativamente más caro |
| Storage | ~$0.02 | ~$0.02 | Igual |
| Email | ~$0.03 | $0.00 | SES vs Gmail API nativo |
| Observabilidad | ~$5.50 | ~$2.50 | CloudWatch más granular pero más caro |
| Frontend + Auth | $0.00 | $0.00 | Ambos tienen free tier generoso |
| Secrets | ~$0.80 | ~$0.01 | AWS Secrets Manager es caro por secret |
| **TOTAL** | **~$20-22/mes** | **~$39-41/mes** |

---

## 6. Costo Externo (igual en ambos)

| Servicio | Costo estimado/mes |
|---|---|
| **DeepSeek API** (4,800 llamadas, ~800 tokens input + ~200 tokens output promedio) | ~$1-3 |
| **Meta WhatsApp API** (business-initiated messages) | Depende del país — ~$0.05-0.08/conversación en LATAM × ~1,200 = **~$60-96** |

> **Nota:** El costo dominante del sistema NO es la infraestructura sino las conversaciones de Meta WhatsApp Business API.

---

## 7. Alternativa sin Redis (para reducir costo en ambos)

Si se reemplaza Redis por cache en base de datos (TTL en DynamoDB / Firestore con campo `expiresAt`):

| | AWS (sin ElastiCache) | GCP (sin Memorystore) |
|---|---|---|
| Total | **~$8-10/mes** | **~$4-6/mes** |

Esto elimina el componente más caro pero agrega ~10-20ms de latencia en lecturas de cache. Para un bot de WhatsApp donde el SLA es de segundos, es perfectamente aceptable.

---

## 8. Frontend de Mantenimiento — Funcionalidades

El admin panel permitiría:

| Módulo | Funcionalidad |
|---|---|
| **Mensajes** | Editar textos del bot (MSG_SALUDO, MSG_TIEMPO, etc.) |
| **Cursos/Certificaciones** | CRUD de certificaciones, modalidades, precios |
| **Asesores** | Gestionar asesores, links de agendamiento, asignación por provider |
| **FAQ** | Editar preguntas frecuentes que alimentan a la IA |
| **Media** | Subir/reemplazar imágenes y videos, forzar refresh de media_ids |
| **Leads** | Ver estado de leads, filtrar por estado, historial de conversación |
| **Métricas** | Dashboard con funnel de conversión, leads por estado |
| **Logs** | Ver logs en tiempo real, filtrar por nivel/función |
| **Config** | Editar API keys, números de test, configuración general |

### Stack recomendado para el frontend:
- **Framework:** Next.js (App Router) o React + Vite
- **UI:** Tailwind CSS + shadcn/ui
- **Auth:** Cognito (AWS) o Firebase Auth (GCP)
- **Deploy:** Amplify (AWS) o Firebase Hosting (GCP)
- **API Backend:** El mismo Lambda/Cloud Function expone endpoints REST para el panel

---

## 9. Recomendación

| Criterio | Ganador |
|---|---|
| **Costo más bajo** | AWS (~$20/mes) o GCP sin Redis (~$4-6/mes) |
| **Integración con Google Calendar/Gmail** | GCP (nativo, sin adaptadores) |
| **Menor esfuerzo de migración desde Apps Script** | GCP (mismo ecosistema Google) |
| **Mejor free tier para frontend** | Empate (Amplify ≈ Firebase Hosting) |
| **Madurez de serverless** | AWS (Lambda más maduro) |
| **Simplicidad operativa** | GCP (menos servicios que configurar) |

**Mi recomendación: GCP sin Memorystore (usando Firestore TTL para cache)** — costo ~$4-6/mes + DeepSeek + Meta. La integración nativa con Calendar y Gmail elimina adaptadores, y Firebase te da frontend + auth gratis.
