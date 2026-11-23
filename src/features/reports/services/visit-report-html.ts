import { PLAN_COLORS } from '@/features/annotations/constants';
import {
  contentBounds,
  elementDrawing,
  fitViewport,
  type DrawingPart,
} from '@/features/annotations/services/geometry';
import { formatDateValue, formatTimeValue } from '@/features/forms/services/field-format';
import { hasAnswer, VISIT_FORMS_MESSAGES } from '@/features/forms/services/visit-forms';
import { formatCoordinates, stampDetails } from '@/features/photos/services/photo-stamp';
import { elementCountLabel, planTitle, type VisitAnnotation } from '@/models/annotation.model';
import type { FormField, FormValue } from '@/models/form.model';
import type { VisitMaterial } from '@/models/material.model';
import { VISIT_STATUS_LABELS, visitTypeLabel } from '@/models/visit.model';
import { colors } from '@/theme/colors';
import { formatDateTime, formatLongDate, formatTime } from '@/utils/date.utils';
import { formatQuantity } from '@/utils/number.utils';

import type { ReportPhoto, VisitReportData } from './visit-report.data';

/**
 * HTML del informe PDF de una visita (función pura: datos → texto). Todo el
 * texto escrito por usuarios pasa por `escapeHtml`: un título o una
 * observación con `<script>` se imprime tal cual, nunca se interpreta.
 */

export const REPORT_TEXTS = {
  title: 'Informe de visita técnica',
  empty: '—',
  notAnswered: 'Sin respuesta',
  yes: 'Sí',
  no: 'No',
  noForms: 'La visita no tiene formularios.',
  noMaterials: 'La visita no tiene materiales registrados.',
  noPhotos: 'La visita no tiene fotografías.',
  noAnnotations: 'La visita no tiene planos.',
  custom: 'personalizado',
  photoMissing: 'La fotografía no está guardada en este dispositivo y no se pudo incluir.',
  photoError: 'No se pudo procesar la fotografía para incluirla en el informe.',
  emptyPlan: 'Plano sin elementos.',
  unknownTemplate:
    'No se encontró la plantilla de este formulario: se muestran las respuestas guardadas.',
} as const;

// ── Escapado ────────────────────────────────────────────────────────────────

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto para HTML (contenido y atributos entre comillas). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Texto escapado conservando los saltos de línea. */
const multiline = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br />');

/** Solo se incrustan imágenes JPEG/PNG en base64 (nunca una URL ni otro esquema). */
const SAFE_DATA_URI = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSafeImageDataUri(value: string): boolean {
  return SAFE_DATA_URI.test(value);
}

// ── Valores de los formularios ───────────────────────────────────────────────

const withUnit = (text: string, unit: string | null) => (unit ? `${text} ${unit}` : text);

/**
 * Respuesta de un campo como texto, según su tipo; `null` si no tiene
 * respuesta (un "No" respondido sí cuenta).
 */
export function formatFieldValue(
  field: Pick<FormField, 'type' | 'unit'>,
  value: FormValue | undefined,
): string | null {
  if (!hasAnswer(value) || value === undefined) return null;
  if (typeof value === 'boolean') return value ? REPORT_TEXTS.yes : REPORT_TEXTS.no;
  if (Array.isArray(value)) return value.join(', ');
  switch (field.type) {
    case 'number':
    case 'decimal':
      return withUnit(typeof value === 'number' ? formatQuantity(value) : value, field.unit);
    case 'date':
      return formatDateValue(String(value));
    case 'time':
      return formatTimeValue(String(value));
    case 'boolean':
      return String(value);
    default:
      return typeof value === 'number' ? formatQuantity(value) : value;
  }
}

/** Respuesta guardada sin plantilla conocida: se muestra lo mejor posible. */
function formatRawValue(value: FormValue): string {
  if (typeof value === 'boolean') return value ? REPORT_TEXTS.yes : REPORT_TEXTS.no;
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'number' ? formatQuantity(value) : value;
}

// ── Fragmentos ───────────────────────────────────────────────────────────────

const LOGO_SVG = `<svg class="logo" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
<rect width="64" height="64" rx="12" fill="${colors.primary}"/>
<rect x="16" y="16.5" width="32.5" height="7.5" rx="2.5" fill="#FFFFFF"/>
<rect x="28.2" y="16.5" width="7.7" height="28.6" rx="2.5" fill="#FFFFFF"/>
<circle cx="43.4" cy="41" r="7.9" fill="${colors.primary}"/>
<circle cx="43.4" cy="41" r="6.6" fill="${colors.secondary}"/>
<path d="M39.6 41.1 L42.4 43.9 L46.6 39" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const section = (title: string, body: string, extraClass = '') =>
  `<section class="section ${extraClass}"><h2>${escapeHtml(title)}</h2>${body}</section>`;

const note = (text: string) => `<p class="note">${escapeHtml(text)}</p>`;

/** Fila de la tabla de datos; vacía se muestra "—". */
const infoRow = (label: string, value: string | null, isMultiline = false) =>
  `<tr><th>${escapeHtml(label)}</th><td>${
    value ? (isMultiline ? multiline(value) : escapeHtml(value)) : REPORT_TEXTS.empty
  }</td></tr>`;

const dateTimeOrNull = (value: string | null) => {
  const text = formatDateTime(value);
  return text.length > 0 ? text : null;
};

function visitSection(data: VisitReportData): string {
  const { visit } = data;
  const coordinates =
    visit.latitude !== null && visit.longitude !== null
      ? formatCoordinates({ latitude: visit.latitude, longitude: visit.longitude })
      : null;
  const rows = [
    infoRow('Título', visit.title),
    infoRow('Cliente', visit.clientName),
    infoRow('Tipo de visita', visitTypeLabel(visit.visitType)),
    infoRow('Dirección', visit.address),
    infoRow('Estado', VISIT_STATUS_LABELS[visit.status]),
    infoRow('Técnico', data.technicianName),
    infoRow('Creada', dateTimeOrNull(visit.createdAt)),
    infoRow('Iniciada', dateTimeOrNull(visit.startedAt)),
    infoRow('Finalizada', dateTimeOrNull(visit.completedAt)),
    infoRow('Coordenadas', coordinates),
    infoRow('Descripción', visit.description, true),
    infoRow('Observaciones', visit.observations, true),
  ];
  return section('Datos de la visita', `<table class="info">${rows.join('')}</table>`);
}

function formsSection(data: VisitReportData): string {
  if (data.forms.length === 0) return section('Formularios', note(REPORT_TEXTS.noForms));

  const blocks = data.forms.map((form) => {
    const state = form.isComplete
      ? `${VISIT_FORMS_MESSAGES.completed}${
          form.response.completedAt ? ` · ${formatDateTime(form.response.completedAt)}` : ''
        }`
      : VISIT_FORMS_MESSAGES.inProgress;
    const header = `<div class="form-header"><h3>${escapeHtml(form.name)}</h3><span class="tag ${
      form.isComplete ? 'tag-ok' : 'tag-pending'
    }">${escapeHtml(state)}</span></div>`;

    if (!form.template) {
      const entries = Object.entries(form.response.values);
      const rows = entries.map(([key, value]) => infoRow(key, formatRawValue(value), true));
      const body = entries.length > 0 ? `<table class="info">${rows.join('')}</table>` : '';
      return `<div class="form">${header}${note(REPORT_TEXTS.unknownTemplate)}${body}</div>`;
    }

    const sections = form.template.sections.map((formSection) => {
      const rows = formSection.fields.map((field) => {
        const value = formatFieldValue(field, form.response.values[field.id]);
        return `<tr><th>${escapeHtml(field.label)}</th><td>${
          value === null
            ? `<span class="muted">${REPORT_TEXTS.notAnswered}</span>`
            : multiline(value)
        }</td></tr>`;
      });
      return `<h4>${escapeHtml(formSection.title)}</h4><table class="info">${rows.join('')}</table>`;
    });
    return `<div class="form">${header}${sections.join('')}</div>`;
  });
  return section('Formularios', blocks.join(''));
}

function materialRow(material: VisitMaterial): string {
  const name = material.isCustom
    ? `${escapeHtml(material.materialName)} <span class="tag tag-custom">${REPORT_TEXTS.custom}</span>`
    : escapeHtml(material.materialName);
  return `<tr><td>${escapeHtml(material.materialCode) || REPORT_TEXTS.empty}</td><td>${name}</td><td>${escapeHtml(
    material.unit,
  )}</td><td class="number">${formatQuantity(material.quantity)}</td><td>${
    material.observations ? multiline(material.observations) : REPORT_TEXTS.empty
  }</td></tr>`;
}

function materialsSection(materials: readonly VisitMaterial[]): string {
  if (materials.length === 0) return section('Materiales', note(REPORT_TEXTS.noMaterials));
  const table = `<table class="grid"><thead><tr><th>Código</th><th>Material</th><th>Unidad</th><th class="number">Cantidad</th><th>Observaciones</th></tr></thead><tbody>${materials
    .map(materialRow)
    .join('')}</tbody></table>`;
  return section('Materiales', table);
}

function photoFigure(item: ReportPhoto, index: number): string {
  const { photo, image } = item;
  const stamp = stampDetails(photo);
  const meta = stamp
    ? `${stamp.dateTime} · ${stamp.location}`
    : formatDateTime(photo.capturedAt) || REPORT_TEXTS.empty;
  const caption = `<figcaption><strong>Foto ${index + 1}</strong>${
    photo.caption ? ` — ${escapeHtml(photo.caption)}` : ''
  }<br /><span class="muted">${escapeHtml(meta)}</span></figcaption>`;

  let content: string;
  if (image.status === 'embedded' && isSafeImageDataUri(image.dataUri)) {
    content = `<img src="${image.dataUri}" alt="${escapeHtml(photo.caption ?? `Foto ${index + 1}`)}" />`;
  } else {
    content = `<div class="placeholder">${escapeHtml(
      image.status === 'missing' ? REPORT_TEXTS.photoMissing : REPORT_TEXTS.photoError,
    )}</div>`;
  }
  return `<figure class="photo">${content}${caption}</figure>`;
}

function photosSection(data: VisitReportData): string {
  if (data.photos.length === 0 && data.omittedPhotoCount === 0) {
    return section('Fotografías', note(REPORT_TEXTS.noPhotos));
  }
  const omitted =
    data.omittedPhotoCount > 0
      ? note(
          `Se incluyen las ${data.photos.length} fotografías más recientes; ${data.omittedPhotoCount} más antiguas no se incluyeron para mantener el tamaño del archivo.`,
        )
      : '';
  return section(
    'Fotografías',
    `${omitted}<div class="photos">${data.photos.map(photoFigure).join('')}</div>`,
  );
}

const num = (value: number) => String(Math.round(value * 1000) / 1000);

/** Ancho y alto (en px CSS) del recuadro de cada plano en el PDF. */
const PLAN_BOX = { width: 640, height: 400 } as const;

function svgPart(part: DrawingPart, color: string, scale: number): string {
  const fill = escapeHtml(color);
  switch (part.kind) {
    case 'stroke':
      return `<path d="${escapeHtml(part.path)}" fill="none" stroke="${fill}" stroke-width="${num(
        part.strokeWidth / scale,
      )}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'marker':
      return `<circle cx="${num(part.cx)}" cy="${num(part.cy)}" r="${num(part.r / scale)}" fill="${fill}"/><circle cx="${num(
        part.cx,
      )}" cy="${num(part.cy)}" r="${num(part.r / scale)}" fill="none" stroke="#FFFFFF" stroke-width="${num(
        part.borderWidth / scale,
      )}"/>`;
    case 'text':
      return `<text x="${num(part.x)}" y="${num(part.y)}" font-size="${num(
        part.fontSize,
      )}" font-weight="600" fill="${fill}">${escapeHtml(part.text)}</text>`;
  }
}

/**
 * Plano dibujado en SVG con la misma geometría que la miniatura de la app
 * (encuadra todo el contenido; grosores en píxeles, texto en centímetros).
 */
export function planSvg(annotation: Pick<VisitAnnotation, 'elements'>): string {
  const view = fitViewport(contentBounds(annotation.elements, 1), PLAN_BOX);
  const shapes = annotation.elements
    .map((element) => {
      const drawing = elementDrawing(element, view.scale);
      if (!drawing) return '';
      const parts = drawing.parts.map((part) => svgPart(part, drawing.color, view.scale));
      return `<g opacity="${num(drawing.opacity)}">${parts.join('')}</g>`;
    })
    .join('');
  return `<svg class="plan" viewBox="0 0 ${PLAN_BOX.width} ${PLAN_BOX.height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${PLAN_COLORS.paper}"/><g transform="translate(${num(
    view.tx,
  )} ${num(view.ty)}) scale(${num(view.scale)})" font-family="sans-serif">${shapes}</g></svg>`;
}

function annotationsSection(annotations: readonly VisitAnnotation[]): string {
  if (annotations.length === 0) return section('Planos', note(REPORT_TEXTS.noAnnotations));
  const blocks = annotations.map((annotation, index) => {
    const title = `<h3>${escapeHtml(planTitle(annotation, index + 1))} <span class="muted">· ${elementCountLabel(
      annotation.elements.length,
    )}</span></h3>`;
    const body =
      annotation.elements.length === 0 ? note(REPORT_TEXTS.emptyPlan) : planSvg(annotation);
    return `<div class="plan-block">${title}${body}</div>`;
  });
  return section('Planos', blocks.join(''));
}

// ── Documento ────────────────────────────────────────────────────────────────

const CSS = `
@page {
  size: A4;
  margin: 16mm 14mm 18mm 14mm;
  @bottom-left { content: "TEINS · ${REPORT_TEXTS.title}"; font-size: 8pt; color: ${colors.textSecondary}; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: ${colors.textSecondary}; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, "Roboto", "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: ${colors.textPrimary}; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.header { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid ${colors.primary}; padding-bottom: 10px; margin-bottom: 14px; }
.header .brand { font-size: 20pt; font-weight: 800; color: ${colors.primary}; letter-spacing: 1px; line-height: 1; }
.header .subtitle { font-size: 11pt; color: ${colors.secondaryDark}; font-weight: 600; }
.header .meta { margin-left: auto; text-align: right; font-size: 8.5pt; color: ${colors.textSecondary}; }
h1 { font-size: 15pt; margin: 0 0 12px; color: ${colors.textPrimary}; }
h2 { font-size: 12.5pt; color: ${colors.primary}; border-bottom: 1px solid ${colors.border}; padding-bottom: 4px; margin: 18px 0 8px; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 10px 0 6px; break-after: avoid; page-break-after: avoid; }
h4 { font-size: 10pt; margin: 10px 0 4px; color: ${colors.primaryDark}; break-after: avoid; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; }
tr, figure, .placeholder, .plan-block { break-inside: avoid; page-break-inside: avoid; }
table.info th { width: 34%; text-align: left; vertical-align: top; font-weight: 600; color: ${colors.textSecondary}; padding: 4px 8px 4px 0; border-bottom: 1px solid ${colors.grey200}; }
table.info td { vertical-align: top; padding: 4px 0; border-bottom: 1px solid ${colors.grey200}; word-break: break-word; }
table.grid th { background: ${colors.surfaceVariant}; text-align: left; font-size: 9pt; padding: 5px 6px; border-bottom: 2px solid ${colors.border}; }
table.grid td { padding: 5px 6px; border-bottom: 1px solid ${colors.grey200}; vertical-align: top; word-break: break-word; }
thead { display: table-header-group; }
.number { text-align: right; white-space: nowrap; }
.muted { color: ${colors.textSecondary}; font-weight: normal; }
.note { color: ${colors.textSecondary}; font-style: italic; margin: 4px 0 8px; }
.form { margin-bottom: 12px; }
.form-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; break-after: avoid; page-break-after: avoid; }
.tag { display: inline-block; font-size: 8pt; font-weight: 600; padding: 1px 6px; border-radius: 8px; white-space: nowrap; }
.tag-ok { background: ${colors.successLight}; color: ${colors.success}; }
.tag-pending { background: ${colors.warningLight}; color: ${colors.warning}; }
.tag-custom { background: ${colors.infoLight}; color: ${colors.info}; }
.photos { display: block; }
figure.photo { margin: 0 0 12px; text-align: center; }
figure.photo img { max-width: 100%; max-height: 120mm; border: 1px solid ${colors.border}; }
figcaption { font-size: 9pt; text-align: left; margin-top: 4px; }
.placeholder { border: 1px dashed ${colors.grey400}; color: ${colors.textSecondary}; padding: 18px; font-style: italic; }
svg.plan { width: 100%; height: auto; border: 1px solid ${colors.border}; }
.footer { margin-top: 20px; padding-top: 6px; border-top: 1px solid ${colors.border}; font-size: 8.5pt; color: ${colors.textSecondary}; }
`;

/** Documento HTML completo del informe, listo para `expo-print`. */
export function buildVisitReportHtml(data: VisitReportData): string {
  const generated = `${formatLongDate(data.generatedAt)}, ${formatTime(data.generatedAt)}`;
  const header = `<header class="header">${LOGO_SVG}<div><div class="brand">TEINS</div><div class="subtitle">${
    REPORT_TEXTS.title
  }</div></div><div class="meta">Generado el<br />${escapeHtml(generated)}</div></header>`;
  const title = `<h1>${escapeHtml(data.visit.title || REPORT_TEXTS.title)}</h1>`;
  const footer = `<footer class="footer">Informe generado en el dispositivo con la app TEINS el ${escapeHtml(
    generated,
  )}. Refleja los datos guardados en el dispositivo en ese momento.</footer>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(`${REPORT_TEXTS.title} — ${data.visit.title}`)}</title>
<style>${CSS}</style>
</head>
<body>
${header}
${title}
${visitSection(data)}
${formsSection(data)}
${materialsSection(data.materials)}
${photosSection(data)}
${annotationsSection(data.annotations)}
${footer}
</body>
</html>`;
}
