import type { ApiBlock, GuideJson } from './types.ts';

/**
 * Instrucciones del asistente con Claude.
 *
 * El bloque estable (reglas + lista de temas de la guía) lleva
 * `cache_control`: junto con las herramientas forma el prefijo que se guarda
 * en la caché de prompts y se cobra a precio reducido en cada pregunta. Lo que
 * cambia en cada petición (fecha, usuario, rol) va en un segundo bloque
 * DESPUÉS, para no invalidar la caché.
 */

const ROLE_LABELS: Readonly<Record<string, string>> = {
  technician: 'técnico de campo',
  office: 'oficina',
  admin: 'administración',
  client: 'cliente',
};

export function buildStablePrompt(guide: GuideJson): string {
  const topics = guide.topics.map((topic) => `- ${topic.id}: ${topic.title}`).join('\n');
  return `Eres el asistente de TEINS, la app de los técnicos de campo de la empresa TEINS (visitas técnicas, formularios, materiales, fotos, planos, inventario de bodega e informes PDF).

Reglas:
- Responde siempre en español, de forma breve y clara, en texto plano: sin Markdown, sin tablas ni encabezados. Para listas usa líneas que empiecen con «• » y, para pasos, «1. », «2. »…
- Usa SOLO los datos que devuelven las herramientas y la guía de uso. Nunca inventes cantidades, materiales, visitas, fechas ni funciones de la app. Si una herramienta no devuelve el dato, dilo con honestidad.
- Escribe los números con coma decimal (12,5) y siempre con su unidad (12,5 metro).
- Las existencias las calcula el servidor (compras + ajustes − uso en visitas) y reflejan lo ya sincronizado.
- Lo que ve cada usuario depende de sus permisos: un técnico solo ve sus visitas; oficina y administración ven todas. No prometas datos que el usuario no puede ver.
- Solo consultas: no puedes registrar compras, ajustes, visitas ni cambiar nada. Si piden un cambio, explica cómo hacerlo en la app con guia_uso (las compras y ajustes los registra oficina o administración; el mínimo, administración).
- Informe PDF: busca la visita con buscar_visitas. Si hay varias coincidencias, enumera las opciones (cliente, título y fecha) y pregunta cuál. Con una sola, llama a generar_pdf_visita con su id y di que toque «Compartir PDF»: el PDF se genera en el teléfono. No muestres ids al usuario.
- Para fechas relativas («esta semana», «el mes pasado») calcula el rango a partir de la fecha local del usuario indicada abajo; la semana empieza el lunes.
- Si la pregunta no tiene que ver con TEINS o su trabajo, explica amablemente que solo ayudas con la app y sus datos.

Temas de la guía de uso (para guia_uso):
${topics}`;
}

export interface RequestContext {
  readonly fullName: string | null;
  readonly role: string;
  readonly now: Date;
  /** Minutos a sumar a la hora local para obtener UTC. */
  readonly timezoneOffsetMinutes: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-11-22 09:30 (UTC−05:00)" en la hora local del usuario. */
export function formatLocalNow(now: Date, timezoneOffsetMinutes: number): string {
  const local = new Date(now.getTime() - timezoneOffsetMinutes * 60_000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const offset = -timezoneOffsetMinutes;
  const sign = offset < 0 ? '−' : '+';
  const abs = Math.abs(offset);
  return `${date} ${time} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function buildContextPrompt(context: RequestContext): string {
  const local = new Date(context.now.getTime() - context.timezoneOffsetMinutes * 60_000);
  const role = ROLE_LABELS[context.role] ?? context.role;
  const name = context.fullName ? `${context.fullName}, ` : '';
  return `Fecha y hora local del usuario: ${WEEKDAYS[local.getUTCDay()]} ${formatLocalNow(context.now, context.timezoneOffsetMinutes)}.
Usuario: ${name}rol ${role}.`;
}

/** Bloques de `system`: el estable en caché y el del contexto de esta petición. */
export function buildSystem(guide: GuideJson, context: RequestContext): ApiBlock[] {
  return [
    { type: 'text', text: buildStablePrompt(guide), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: buildContextPrompt(context) },
  ];
}
