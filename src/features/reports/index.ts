/**
 * API pública del informe PDF de visitas (la usa la pantalla de la visita y
 * la usará el asistente): buscar la visita, generar el PDF sin conexión y
 * abrir la hoja de compartir del sistema.
 */
export {
  findVisitsForReport,
  type FindVisitsForReportOptions,
  type ReportDatabase,
} from './services/visit-report.data';
export {
  generateVisitReportPdf,
  REPORT_MESSAGES,
  shareVisitReport,
  type GenerateVisitReportOptions,
  type VisitReportFile,
} from './services/visit-report.service';
