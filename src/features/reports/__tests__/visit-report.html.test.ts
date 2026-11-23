import { buildTemplateCatalog } from '@/features/forms/services/template.service';
import { buildVisitForms } from '@/features/forms/services/visit-forms';
import { annotationFromRow } from '@/models/annotation.model';
import { responseFromRow, TEMPLATE_KEY } from '@/models/form.model';
import { visitMaterialFromRow } from '@/models/material.model';
import { photoFromRow } from '@/models/photo.model';
import { visitFromRow } from '@/models/visit.model';
import {
  annotationRow,
  photoRow,
  responseRow,
  templateRow,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';

import type { VisitReportData } from '../services/visit-report.data';
import {
  buildVisitReportHtml,
  escapeHtml,
  formatFieldValue,
  isSafeImageDataUri,
  planSvg,
  REPORT_TEXTS,
} from '../services/visit-report.html';

/** HTML del informe: contenido, formato por tipo de campo y escapado (XSS). */

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const XSS = '<script>alert("x")</script>';

const ALL_TYPES_TEMPLATE = templateRow({
  id: 'tpl-todo',
  name: 'Checklist <b>completo</b>',
  sections_json: JSON.stringify([
    {
      id: 's1',
      title: 'Medidas & datos',
      fields: [
        { id: 'texto', type: 'text', label: 'Texto' },
        { id: 'largo', type: 'textarea', label: 'Notas' },
        { id: 'entero', type: 'number', label: 'Equipos' },
        { id: 'voltaje', type: 'decimal', label: 'Voltaje', unit: 'V' },
        { id: 'texto_num', type: 'decimal', label: 'Escrito', unit: 'A' },
        { id: 'ok', type: 'boolean', label: '¿Funciona?' },
        { id: 'no_ok', type: 'boolean', label: '¿Ruido?' },
        { id: 'fecha', type: 'date', label: 'Fecha' },
        { id: 'hora', type: 'time', label: 'Hora' },
        { id: 'estado', type: 'select', label: 'Estado', options: ['Bueno', 'Malo'] },
        { id: 'varios', type: 'multiSelect', label: 'Hallazgos', options: ['Polvo', 'Óxido'] },
        { id: 'vacio', type: 'text', label: 'Sin responder' },
      ],
    },
  ]),
});

function reportData(overrides: Partial<VisitReportData> = {}): VisitReportData {
  const visit = visitFromRow(
    visitRow({
      title: `Visita ${XSS}`,
      client_name: 'Clínica "Sur" & Cía',
      status: 'completed',
      address: 'Av. 1 <2>',
      latitude: -3.993421,
      longitude: -79.204512,
      started_at: '2026-06-01T09:00:00.000Z',
      completed_at: '2026-06-01T12:00:00.000Z',
      observations: `Línea 1\nLínea 2 ${XSS}`,
    }),
  );
  const forms = buildVisitForms(
    [
      responseFromRow(
        responseRow({
          id: 'r1',
          template_id: 'tpl-todo',
          is_complete: 1,
          completed_at: '2026-06-01T11:00:00.000Z',
          responses: JSON.stringify({
            texto: XSS,
            largo: 'uno\ndos',
            entero: 3,
            voltaje: 220.5,
            texto_num: '12,5',
            ok: true,
            no_ok: false,
            fecha: '2026-06-01',
            hora: '14:05',
            estado: 'Bueno',
            varios: ['Polvo', 'Óxido'],
          }),
        }),
      ),
      responseFromRow(
        responseRow({
          id: 'r2',
          responses: JSON.stringify({ [TEMPLATE_KEY]: 'desconocida', campo_viejo: 'valor', n: 2 }),
        }),
      ),
    ],
    buildTemplateCatalog([ALL_TYPES_TEMPLATE], []),
    'tipo-sin-plantilla',
  );
  return {
    visit,
    technicianName: 'Ana <Técnica>',
    forms,
    materials: [
      visitMaterialFromRow(visitMaterialRow({ quantity: 2.5, unit: 'metro' })),
      visitMaterialFromRow(
        visitMaterialRow({
          id: 'vm2',
          material_id: null,
          is_custom: 1,
          material_code: '',
          material_name: `Abrazadera ${XSS}`,
          observations: 'Traída del almacén',
        }),
      ),
    ],
    photos: [
      {
        photo: photoFromRow(
          photoRow({
            id: 'p1',
            caption: `Tablero ${XSS}`,
            taken_at: '2026-06-01T09:15:00.000Z',
            latitude: -3.99,
            longitude: -79.2,
            location_accuracy: 8,
          }),
        ),
        image: { status: 'embedded', dataUri: 'data:image/jpeg;base64,QUJD' },
      },
      { photo: photoFromRow(photoRow({ id: 'p2' })), image: { status: 'missing' } },
      { photo: photoFromRow(photoRow({ id: 'p3' })), image: { status: 'error' } },
      {
        photo: photoFromRow(photoRow({ id: 'p4' })),
        image: { status: 'embedded', dataUri: 'javascript:alert(1)' },
      },
    ],
    omittedPhotoCount: 2,
    annotations: [
      annotationFromRow(
        annotationRow({
          id: 'a1',
          title: `Planta ${XSS}`,
          elements: JSON.stringify([
            {
              id: 'e1',
              type: 'line',
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              color: 0xff0000ff,
            },
            { id: 'e2', type: 'marker', points: [{ x: 50, y: 50 }], strokeWidth: 3 },
            { id: 'e3', type: 'text', points: [{ x: 10, y: 10 }], text: XSS, fontSize: 12 },
            {
              id: 'e4',
              type: 'dimension',
              points: [
                { x: 0, y: 80 },
                { x: 100, y: 80 },
              ],
            },
          ]),
        }),
      ),
      annotationFromRow(annotationRow({ id: 'a2', title: null })),
    ],
    generatedAt: new Date(2026, 5, 2, 10, 30),
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapa los caracteres especiales de HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('solo acepta imágenes JPEG/PNG en base64', () => {
    expect(isSafeImageDataUri('data:image/jpeg;base64,QUJD')).toBe(true);
    expect(isSafeImageDataUri('data:image/png;base64,QUJD==')).toBe(true);
    expect(isSafeImageDataUri('data:image/svg+xml;base64,QUJD')).toBe(false);
    expect(isSafeImageDataUri('data:image/jpeg;base64,QUJD" onerror="x')).toBe(false);
    expect(isSafeImageDataUri('https://example.com/a.jpg')).toBe(false);
  });
});

describe('formatFieldValue', () => {
  const field = (type: string, unit: string | null = null) =>
    ({ type, unit }) as Parameters<typeof formatFieldValue>[0];

  it('formatea cada tipo de campo', () => {
    expect(formatFieldValue(field('text'), 'hola')).toBe('hola');
    expect(formatFieldValue(field('text'), 7)).toBe('7');
    expect(formatFieldValue(field('decimal', 'V'), 220.5)).toBe('220,5 V');
    expect(formatFieldValue(field('number'), 3)).toBe('3');
    expect(formatFieldValue(field('boolean'), true)).toBe('Sí');
    expect(formatFieldValue(field('boolean'), false)).toBe('No');
    expect(formatFieldValue(field('boolean'), 'quizá')).toBe('quizá');
    expect(formatFieldValue(field('date'), '2026-06-01')).toBe('lunes, 1 de junio de 2026');
    expect(formatFieldValue(field('time'), '14:05')).toBe('14:05');
    expect(formatFieldValue(field('multiSelect'), ['a', 'b'])).toBe('a, b');
  });

  it('sin respuesta devuelve null', () => {
    expect(formatFieldValue(field('text'), undefined)).toBeNull();
    expect(formatFieldValue(field('text'), '  ')).toBeNull();
    expect(formatFieldValue(field('multiSelect'), [])).toBeNull();
  });
});

describe('buildVisitReportHtml', () => {
  it('nunca deja pasar etiquetas escritas por el usuario', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>completo</b>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Clínica &quot;Sur&quot; &amp; Cía');
  });

  it('incluye cabecera, datos de la visita y pie con la fecha de generación', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html).toContain('<html lang="es">');
    expect(html).toContain('size: A4');
    expect(html).toContain('counter(page)');
    expect(html).toContain('TEINS');
    expect(html).toContain('martes, 2 de junio de 2026, 10:30');
    expect(html).toContain('Ana &lt;Técnica&gt;');
    expect(html).toContain('Completada');
    expect(html).toContain('Visita Técnica TEINS');
    expect(html).toContain('-3.993421, -79.204512');
    expect(html).toContain('Línea 1<br />Línea 2');
  });

  it('muestra cada formulario con sus secciones y respuestas formateadas', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html).toContain('Checklist &lt;b&gt;completo&lt;/b&gt;');
    expect(html).toContain('Medidas &amp; datos');
    expect(html).toContain('220,5 V');
    expect(html).toContain('12,5 A');
    expect(html).toContain('<td>Sí</td>');
    expect(html).toContain('<td>No</td>');
    expect(html).toContain('lunes, 1 de junio de 2026');
    expect(html).toContain('Polvo, Óxido');
    expect(html).toContain('uno<br />dos');
    expect(html).toContain(REPORT_TEXTS.notAnswered);
    expect(html).toContain('Completado ·');
    // Formulario cuya plantilla ya no se conoce: respuestas guardadas tal cual.
    expect(html).toContain(REPORT_TEXTS.unknownTemplate);
    expect(html).toContain('campo_viejo');
    expect(html).toContain('En curso');
  });

  it('lista los materiales y marca los personalizados', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html).toContain('MAT-001');
    expect(html).toContain('2,5');
    expect(html).toContain(`<span class="tag tag-custom">${REPORT_TEXTS.custom}</span>`);
    expect(html).toContain('Traída del almacén');
  });

  it('incrusta las fotos y avisa de las que faltan o no se pudieron procesar', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('src="data:image/jpeg;base64,QUJD"');
    expect(html).toContain('Tablero &lt;script&gt;');
    expect(html).toContain('-3.990000, -79.200000 ±8 m');
    expect(html).toContain(REPORT_TEXTS.photoMissing);
    expect(html.split(REPORT_TEXTS.photoError)).toHaveLength(3);
    expect(html).toContain('2 más antiguas no se incluyeron');
  });

  it('dibuja los planos en SVG y avisa de los vacíos', () => {
    const html = buildVisitReportHtml(reportData());

    expect(html).toContain('<svg class="plan"');
    expect(html).toContain('Planta &lt;script&gt;');
    expect(html).toContain('4 elementos');
    expect(html).toContain('Plano 2');
    expect(html).toContain(REPORT_TEXTS.emptyPlan);
  });

  it('indica las secciones vacías', () => {
    const html = buildVisitReportHtml(
      reportData({ forms: [], materials: [], photos: [], omittedPhotoCount: 0, annotations: [] }),
    );

    expect(html).toContain(REPORT_TEXTS.noForms);
    expect(html).toContain(REPORT_TEXTS.noMaterials);
    expect(html).toContain(REPORT_TEXTS.noPhotos);
    expect(html).toContain(REPORT_TEXTS.noAnnotations);
  });

  it('sin técnico ni fechas muestra un guion', () => {
    const data = reportData({ technicianName: null });
    const visit = visitFromRow(visitRow({ title: '', started_at: null, completed_at: null }));
    const html = buildVisitReportHtml({ ...data, visit });

    expect(html).toContain(`<th>Técnico</th><td>${REPORT_TEXTS.empty}</td>`);
    expect(html).toContain(`<th>Iniciada</th><td>${REPORT_TEXTS.empty}</td>`);
    expect(html).toContain(`<h1>${REPORT_TEXTS.title}</h1>`);
  });
});

describe('planSvg', () => {
  it('dibuja trazos, marcadores y textos con la geometría de la app', () => {
    const plan = annotationFromRow(
      annotationRow({
        elements: JSON.stringify([
          {
            id: 'l',
            type: 'arrow',
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 50 },
            ],
          },
          { id: 'm', type: 'marker', points: [{ x: 20, y: 20 }] },
          { id: 't', type: 'text', points: [{ x: 5, y: 5 }], text: 'A & B' },
        ]),
      }),
    );
    const svg = planSvg(plan);

    expect(svg).toContain('<path d="M 0 0 L 50 50');
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain('>A &amp; B</text>');
  });
});
