/**
 * Datos de ejemplo del modo demo.
 *
 * Son los mismos del seed de demostración del proyecto original (catálogo de
 * 14 materiales y 3 visitas). Solo se escriben en la base aislada del modo
 * demo, que nunca se conecta al servidor.
 */

export interface DemoMaterial {
  code: string;
  name: string;
  description: string;
  unit: string;
  category: string;
}

export const DEMO_MATERIALS: readonly DemoMaterial[] = [
  {
    code: 'CABLE-UTP-CAT6',
    name: 'Cable UTP Cat6',
    description: 'Cable de red UTP categoría 6, 23 AWG',
    unit: 'metro',
    category: 'Cableado',
  },
  {
    code: 'CABLE-THHN-12',
    name: 'Cable THHN #12 AWG',
    description: 'Cable eléctrico THHN calibre 12',
    unit: 'metro',
    category: 'Cableado',
  },
  {
    code: 'CABLE-THHN-10',
    name: 'Cable THHN #10 AWG',
    description: 'Cable eléctrico THHN calibre 10',
    unit: 'metro',
    category: 'Cableado',
  },
  {
    code: 'FIBRA-SM-OS2',
    name: 'Fibra óptica OS2 monomodo',
    description: 'Fibra óptica monomodo OS2 para exteriores',
    unit: 'metro',
    category: 'Cableado',
  },
  {
    code: 'CONEC-RJ45-CAT6',
    name: 'Conector RJ45 Cat6',
    description: 'Conector macho RJ45 para cable Cat6',
    unit: 'unidad',
    category: 'Conectores',
  },
  {
    code: 'CONEC-LC-SM',
    name: 'Conector LC monomodo',
    description: 'Conector LC/UPC para fibra monomodo',
    unit: 'unidad',
    category: 'Conectores',
  },
  {
    code: 'TUBO-EMT-3/4',
    name: 'Tubería EMT 3/4"',
    description: 'Tubería metálica EMT para instalaciones eléctricas',
    unit: 'metro',
    category: 'Tubería',
  },
  {
    code: 'CANALETA-40X25',
    name: 'Canaleta 40×25 mm',
    description: 'Canaleta plástica para cable de red 40×25mm',
    unit: 'metro',
    category: 'Tubería',
  },
  {
    code: 'BREAKER-1P-20A',
    name: 'Breaker 1P 20A',
    description: 'Interruptor termomagnético 1 polo 20 amperios',
    unit: 'unidad',
    category: 'Protecciones',
  },
  {
    code: 'BREAKER-2P-30A',
    name: 'Breaker 2P 30A',
    description: 'Interruptor termomagnético 2 polos 30 amperios',
    unit: 'unidad',
    category: 'Protecciones',
  },
  {
    code: 'PATCH-PANEL-24',
    name: 'Patch panel 24 puertos Cat6',
    description: 'Panel de parcheo 24 puertos Cat6 1U',
    unit: 'unidad',
    category: 'Equipos de red',
  },
  {
    code: 'KEYSTONE-CAT6',
    name: 'Keystone Jack Cat6',
    description: 'Módulo keystone hembra Cat6',
    unit: 'unidad',
    category: 'Equipos de red',
  },
  {
    code: 'ABRAZA-3/4',
    name: 'Abrazadera 3/4"',
    description: 'Abrazadera metálica para tubería 3/4"',
    unit: 'unidad',
    category: 'Fijación',
  },
  {
    code: 'BRIDA-NEGRO',
    name: 'Brida nylon 300mm',
    description: 'Brida de amarre de nylon negra 300mm',
    unit: 'unidad',
    category: 'Fijación',
  },
];

export interface DemoVisit {
  title: string;
  visitType: string;
  address: string;
  clientName: string;
  description: string;
  status: 'assigned' | 'inProgress';
  /** Antigüedad de la visita respecto al momento de crear los datos. */
  createdHoursAgo: number;
}

export const DEMO_VISITS: readonly DemoVisit[] = [
  {
    title: 'VT-00001 — Inspección Infraestructura Almacén Sur',
    visitType: 'infraestructura',
    address: 'Calle Industrial 123, Zona Sur, Loja',
    clientName: 'Almacenes ABC S.A.',
    description: 'Revisión completa de infraestructura del almacén zona sur.',
    status: 'assigned',
    createdHoursAgo: 48,
  },
  {
    title: 'VT-00002 — Inspección Energía Planta Norte',
    visitType: 'energia',
    address: 'Av. Industrial Norte 456, Parque Industrial',
    clientName: 'Industrias XYZ Ltda.',
    description: 'Inspección del sistema eléctrico planta de producción.',
    status: 'inProgress',
    createdHoursAgo: 24,
  },
  {
    title: 'VT-00003 — Instalación Red Datos Oficinas Centrales',
    visitType: 'datos',
    address: 'Torre Empresarial, Piso 8, Centro',
    clientName: 'Corporación DEF',
    description: 'Instalación y certificación de red Cat6 en 3 pisos.',
    status: 'assigned',
    createdHoursAgo: 3,
  },
];

/** Operaciones de base de datos que necesita la carga de datos demo. */
export interface SeedTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
}

export interface SeedDatabase {
  writeTransaction: <T>(callback: (tx: SeedTransaction) => Promise<T>) => Promise<T>;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Carga los datos de ejemplo en una sola transacción (todo o nada).
 * La base demo se vacía antes de cada sesión, así que siempre parte de cero.
 */
export async function seedDemoData(
  db: SeedDatabase,
  technicianId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.writeTransaction(async (tx) => {
    for (const material of DEMO_MATERIALS) {
      await tx.execute(
        `INSERT INTO material_catalog (id, code, name, description, unit, category, is_active)
         VALUES (uuid(), ?, ?, ?, ?, ?, 1)`,
        [material.code, material.name, material.description, material.unit, material.category],
      );
    }

    for (const visit of DEMO_VISITS) {
      const createdAt = new Date(now.getTime() - visit.createdHoursAgo * HOUR_MS).toISOString();
      // Una visita en progreso se inició una hora después de crearse.
      const startedAt =
        visit.status === 'inProgress'
          ? new Date(now.getTime() - (visit.createdHoursAgo - 1) * HOUR_MS).toISOString()
          : null;

      await tx.execute(
        `INSERT INTO visits (
           id, technician_id, client_name, title, description, visit_type, address,
           status, sync_status, created_at, updated_at, started_at
         ) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?)`,
        [
          technicianId,
          visit.clientName,
          visit.title,
          visit.description,
          visit.visitType,
          visit.address,
          visit.status,
          createdAt,
          startedAt ?? createdAt,
          startedAt,
        ],
      );
    }
  });
}
