import { contentWords, hasAnyWord, hasPhrase, normalizeText, tokenize } from '../text';

/**
 * Interpretación de la pregunta del asistente básico (sin IA): reglas con
 * palabras clave, sin tildes ni mayúsculas y tolerantes a errores de tecleo.
 * Solo decide QUÉ se pregunta; las respuestas salen de la base (handlers.ts).
 */

export type VisitFilterIntent =
  'pending' | 'today' | 'inProgress' | 'assigned' | 'completed' | 'all';

/** Visita nombrada por referencia en vez de por cliente o título. */
export type VisitReference = 'latest' | 'today' | 'yesterday';

export type Intent =
  | { readonly kind: 'greeting' }
  | { readonly kind: 'help' }
  | { readonly kind: 'thanks' }
  | { readonly kind: 'guide' }
  | { readonly kind: 'pdf'; readonly words: readonly string[] }
  | { readonly kind: 'open_inventory' }
  | { readonly kind: 'consumption'; readonly words: readonly string[] }
  /** `words`: si nombran un material, se responde con sus existencias y su mínimo. */
  | { readonly kind: 'purchase'; readonly words: readonly string[] }
  | {
      readonly kind: 'visits';
      readonly filter: VisitFilterIntent;
      readonly words: readonly string[];
    }
  | { readonly kind: 'stock'; readonly words: readonly string[] }
  /**
   * Materiales usados en UNA visita («¿cuánto cable usé en la visita de
   * Pérez?»). `materialWords`: el material preguntado (vacío = todos);
   * `visitWords`: cliente o título; `reference`: «última», «de hoy», «de ayer».
   */
  | {
      readonly kind: 'visit_materials';
      readonly materialWords: readonly string[];
      readonly visitWords: readonly string[];
      readonly reference: VisitReference | null;
    }
  /** En qué visitas se usó un material («¿en qué visitas se usó cable?»), una por una. */
  | { readonly kind: 'material_visits'; readonly words: readonly string[] }
  /** No coincide con nada conocido: se intenta como nombre de material. */
  | { readonly kind: 'unknown'; readonly words: readonly string[] };

const GREETING_WORDS = [
  'hola',
  'holi',
  'buenas',
  'buenos',
  'saludos',
  'hey',
  'hello',
  'dias',
  'tardes',
  'noches',
  'tal',
];
const THANKS_WORDS = [
  'gracias',
  'ok',
  'okey',
  'vale',
  'perfecto',
  'genial',
  'listo',
  'excelente',
  'muchas',
  'mil',
];
const HELP_PHRASES = [
  'ayuda',
  'ayudame',
  'que puedes hacer',
  'que sabes hacer',
  'que haces',
  'para que sirves',
  'opciones',
  'menu',
];
const GUIDE_WORDS = [
  'guia',
  'tutorial',
  'pasos',
  'explicame',
  'ensename',
  'instrucciones',
  'manual',
];
const GUIDE_PHRASES = [
  'paso a paso',
  'donde esta',
  'donde veo',
  'donde encuentro',
  'que significa',
];
const PDF_WORDS = ['pdf', 'informe', 'reporte', 'report'];
const OPEN_INVENTORY_PHRASES = [
  'abrir inventario',
  'abrir el inventario',
  'abre el inventario',
  'abre inventario',
  'ir al inventario',
  'ver el inventario',
  'ver inventario',
  'mostrar inventario',
];
const CONSUMPTION_WORDS = [
  'consumo',
  'consumido',
  'consumida',
  'consumidos',
  'consumi',
  'consumimos',
  'consumieron',
  'gaste',
  'gastado',
  'gastamos',
  'gastaron',
  'usado',
  'usados',
  'use',
  'usamos',
  'usaron',
  'utilizado',
  'utilice',
  'utilizamos',
  'ocupado',
  'ocupe',
  'ocupamos',
  'salio',
  'salieron',
];
const PURCHASE_WORDS = [
  'comprar',
  'compramos',
  'reponer',
  'reposicion',
  'pedir',
  'pedido',
  'falta',
  'faltan',
  'agotado',
  'agotados',
  'agotando',
  'acabando',
  'escaso',
  'escasos',
  'minimo',
  'minimos',
];
const STOCK_WORDS = [
  'stock',
  'existencia',
  'existencias',
  'queda',
  'quedan',
  'inventario',
  'bodega',
  'disponible',
  'disponibles',
  'cuanto',
  'cuantos',
  'cuanta',
  'cuantas',
  'hay',
  'tengo',
  'tenemos',
  'material',
  'materiales',
];
const VISIT_WORDS = ['visita', 'visitas', 'trabajo', 'trabajos', 'agenda'];
/** Verbos de "usar material" además de los de consumo (necesité, llevé, puse, instalé…). */
const MATERIAL_USE_WORDS = [
  ...CONSUMPTION_WORDS,
  'uso',
  'usa',
  'usaste',
  'usar',
  'necesite',
  'necesitamos',
  'necesitaron',
  'necesitaste',
  'necesitaba',
  'requiri',
  'requirio',
  'lleve',
  'llevamos',
  'llevaron',
  'puse',
  'pusimos',
  'pusieron',
  'instale',
  'instalamos',
  'instalaron',
  'instalado',
  'coloque',
  'colocamos',
  'colocaron',
  'cambie',
  'cambiamos',
];
const MATERIAL_NOUNS = ['material', 'materiales', 'insumo', 'insumos', 'repuesto', 'repuestos'];
const QUANTITY_WORDS = ['cuanto', 'cuanta', 'cuantos', 'cuantas'];
const LATEST_WORDS = ['ultima', 'ultimo', 'reciente', 'recien'];
/** Palabras que no son ni el material ni la visita en «materiales de la visita…». */
const VISIT_MATERIAL_IGNORED = [
  ...MATERIAL_USE_WORDS,
  ...MATERIAL_NOUNS,
  ...QUANTITY_WORDS,
  ...LATEST_WORDS,
  'visita',
  'visitas',
  'hoy',
  'ayer',
  'cuales',
  'total',
  'cantidad',
  'cantidades',
];

export const VISIT_FILTER_WORDS: Readonly<
  Record<Exclude<VisitFilterIntent, 'all'>, readonly string[]>
> = {
  today: ['hoy'],
  pending: ['pendiente', 'pendientes', 'abiertas', 'faltan', 'falta'],
  inProgress: ['curso', 'progreso', 'iniciada', 'iniciadas', 'empezada', 'empezadas'],
  assigned: ['asignada', 'asignadas', 'nuevas'],
  completed: [
    'completada',
    'completadas',
    'terminada',
    'terminadas',
    'finalizada',
    'finalizadas',
    'cerradas',
    'hechas',
  ],
};

/** Palabras de cada tipo de pregunta: se quitan al buscar un material o una visita. */
export const INTENT_WORDS: readonly string[] = [
  ...PDF_WORDS,
  ...CONSUMPTION_WORDS,
  ...PURCHASE_WORDS,
  ...STOCK_WORDS,
  ...VISIT_WORDS,
  'consumo',
  'genera',
  'generar',
  'generame',
  'descargar',
  'descarga',
  'compartir',
  'comparte',
  'enviar',
  'envia',
  'mandar',
  'manda',
  'sacar',
  'saca',
  'crear',
  'hacer',
  'dame',
  'buscar',
  'busca',
  'encuentra',
  'ver',
  'muestra',
  'mostrar',
  'cliente',
  'clientes',
  'unidad',
  'unidades',
  'metro',
  'metros',
  'hasta',
  'ahora',
  'momento',
  'actualmente',
  'actual',
  'ahi',
];

const onlyWordsFrom = (words: readonly string[], allowed: readonly string[]) =>
  words.length > 0 && contentWords(words, allowed).length === 0;

function visitFilter(words: readonly string[], normalized: string): VisitFilterIntent {
  if (hasPhrase(normalized, 'hoy')) return 'today';
  if (hasPhrase(normalized, 'en curso') || hasPhrase(normalized, 'en progreso')) {
    return 'inProgress';
  }
  if (hasPhrase(normalized, 'por hacer') || hasPhrase(normalized, 'sin terminar')) return 'pending';
  for (const filter of ['pending', 'inProgress', 'assigned', 'completed'] as const) {
    if (hasAnyWord(words, VISIT_FILTER_WORDS[filter])) return filter;
  }
  return 'all';
}

const FILTER_IGNORED = Object.values(VISIT_FILTER_WORDS).flat();

const isVisitWord = (word: string) => word === 'visita' || word === 'visitas';

/** ¿Pregunta por material (no por cuántas visitas hay)? */
function asksAboutMaterial(words: readonly string[]): boolean {
  if (hasAnyWord(words, MATERIAL_USE_WORDS) || hasAnyWord(words, MATERIAL_NOUNS)) return true;
  // «cuánto cable…» sí; «cuántas visitas…» no.
  return words.some(
    (word, index) => QUANTITY_WORDS.includes(word) && !isVisitWord(words[index + 1] ?? ''),
  );
}

const materialPart = (words: readonly string[]) =>
  contentWords(words, [...INTENT_WORDS, ...VISIT_MATERIAL_IGNORED]);

/**
 * «¿Cuánto cable necesité en la visita de Pérez?»: lo que va antes de
 * «visita» es el material y lo que va después, la visita. Si antes no hay
 * material («en la visita de Pérez, ¿cuánto cable usé?»), se pasa todo y el
 * manejador separa el material de la visita con el catálogo.
 */
function visitMaterialsIntent(words: readonly string[], normalized: string): Intent {
  const at = words.findIndex(isVisitWord);
  const before = materialPart(words.slice(0, at));
  const after = materialPart(words.slice(at + 1));
  let reference: VisitReference | null = null;
  if (hasAnyWord(words, LATEST_WORDS)) reference = 'latest';
  else if (hasPhrase(normalized, 'hoy')) reference = 'today';
  else if (hasPhrase(normalized, 'ayer')) reference = 'yesterday';
  return {
    kind: 'visit_materials',
    materialWords: before,
    visitWords: after,
    reference,
  };
}

/** ¿Pregunta por materiales de visitas? Devuelve el intent o `null`. */
function detectVisitMaterials(words: readonly string[], normalized: string): Intent | null {
  if (!words.some(isVisitWord) || !asksAboutMaterial(words)) return null;
  const singularVisit = words.includes('visita');
  if (singularVisit) return visitMaterialsIntent(words, normalized);
  // Plural: «¿en qué visitas se usó cable?», «¿en cuántas visitas usamos breaker?».
  const asksWhich =
    hasPhrase(normalized, 'que visitas') ||
    hasPhrase(normalized, 'cuales visitas') ||
    hasPhrase(normalized, 'cuantas visitas');
  return asksWhich ? { kind: 'material_visits', words: materialPart(words) } : null;
}

/** ¿Qué pregunta el usuario? */
export function detectIntent(text: string): Intent {
  const normalized = normalizeText(text);
  const words = tokenize(text);
  if (words.length === 0) return { kind: 'help' };

  if (onlyWordsFrom(words, THANKS_WORDS)) return { kind: 'thanks' };
  if (hasAnyWord(words.slice(0, 2), GREETING_WORDS) && onlyWordsFrom(words, GREETING_WORDS)) {
    return { kind: 'greeting' };
  }
  if (HELP_PHRASES.some((phrase) => hasPhrase(normalized, phrase))) {
    // "ayuda con el inventario" es una pregunta de uso, no el menú general.
    const rest = contentWords(words, ['ayuda', 'ayudame', 'puedes', 'hacer', 'sabes', 'sirves']);
    return rest.length > 0 ? { kind: 'guide' } : { kind: 'help' };
  }
  if (
    words[0] === 'como' ||
    (words[0] === 'y' && words[1] === 'como') ||
    hasAnyWord(words, GUIDE_WORDS) ||
    GUIDE_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
  ) {
    return { kind: 'guide' };
  }
  if (hasAnyWord(words, PDF_WORDS)) {
    return { kind: 'pdf', words: contentWords(words, INTENT_WORDS) };
  }
  if (OPEN_INVENTORY_PHRASES.some((phrase) => hasPhrase(normalized, phrase))) {
    return { kind: 'open_inventory' };
  }
  const visitMaterials = detectVisitMaterials(words, normalized);
  if (visitMaterials) return visitMaterials;
  if (hasAnyWord(words, CONSUMPTION_WORDS)) {
    return { kind: 'consumption', words: contentWords(words, INTENT_WORDS) };
  }
  if (
    hasAnyWord(words, PURCHASE_WORDS) ||
    hasPhrase(normalized, 'bajo minimo') ||
    hasPhrase(normalized, 'por debajo')
  ) {
    if (!hasAnyWord(words, VISIT_WORDS)) {
      return { kind: 'purchase', words: contentWords(words, [...INTENT_WORDS, 'bajo', 'debajo']) };
    }
  }
  if (hasAnyWord(words, VISIT_WORDS)) {
    return {
      kind: 'visits',
      filter: visitFilter(words, normalized),
      words: contentWords(words, [...INTENT_WORDS, ...FILTER_IGNORED, 'curso', 'progreso']),
    };
  }
  if (hasAnyWord(words, STOCK_WORDS)) {
    return { kind: 'stock', words: contentWords(words, INTENT_WORDS) };
  }
  return { kind: 'unknown', words: contentWords(words, INTENT_WORDS) };
}
