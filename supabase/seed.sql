-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Datos de demostración (seed)
--
-- Ejecutar DESPUÉS de las migraciones. Solo para desarrollo/pruebas: NO en
-- producción. Se puede ejecutar varias veces (UUIDs fijos + ON CONFLICT).
--
-- Contenido:
--   • 5 tipos de visita.
--   • 5 plantillas de formulario. Su sections_json es EXACTAMENTE el de
--     src/assets/form_templates.json (la validación lo comprueba).
--   • 14 materiales de catálogo.
--   • Perfiles demo y 3 visitas demo, SOLO si existen los usuarios
--     tecnico@teins.com / oficina@teins.com en auth.users. Si no existen, se
--     omiten sin error: crea los usuarios (docs/BACKEND.md, paso 4) y vuelve
--     a ejecutar este archivo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tipos de visita ──────────────────────────────────────────────────────────
INSERT INTO public.visit_types (id, name, description, icon, is_active) VALUES
    ('30000000-0000-4000-8000-000000000001', 'Infraestructura', 'Visitas de inspección de infraestructura física', 'construction', TRUE),
    ('30000000-0000-4000-8000-000000000002', 'Energía', 'Visitas de inspección y mantenimiento eléctrico', 'bolt', TRUE),
    ('30000000-0000-4000-8000-000000000003', 'Datos', 'Visitas de instalación y soporte de redes de datos', 'cable', TRUE),
    ('30000000-0000-4000-8000-000000000004', 'General', 'Visita técnica general TEINS', 'build', TRUE),
    ('30000000-0000-4000-8000-000000000005', 'UPS', 'Informe técnico de UPS (CDP)', 'battery', TRUE)
ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    icon        = EXCLUDED.icon,
    is_active   = EXCLUDED.is_active;

-- ── Plantillas de formulario (generadas desde src/assets/form_templates.json)
INSERT INTO public.form_templates (id, name, visit_type, version, sections_json, is_active) VALUES
    -- Formato Visita Técnica TEINS (asset: teins_visita_v1)
    ('10000000-0000-4000-8000-000000000004', 'Formato Visita Técnica TEINS', 'general', 1,
     $tpl$[
  {
    "id": "datos_servicio",
    "title": "Datos del Servicio",
    "order": 0,
    "fields": [
      {
        "id": "cliente",
        "type": "text",
        "label": "Cliente",
        "required": true
      },
      {
        "id": "nit",
        "type": "text",
        "label": "NIT",
        "required": false
      },
      {
        "id": "orden_servicio",
        "type": "text",
        "label": "Orden de Servicio",
        "required": false
      },
      {
        "id": "direccion",
        "type": "text",
        "label": "Dirección",
        "required": true
      },
      {
        "id": "ciudad",
        "type": "text",
        "label": "Ciudad",
        "required": false
      },
      {
        "id": "sede",
        "type": "text",
        "label": "Sede",
        "required": false
      },
      {
        "id": "solicitante",
        "type": "text",
        "label": "Solicitante",
        "required": false
      },
      {
        "id": "telefono",
        "type": "text",
        "label": "Teléfono",
        "required": false
      },
      {
        "id": "fecha_servicio",
        "type": "date",
        "label": "Fecha de Servicio",
        "required": true
      },
      {
        "id": "hora_inicio",
        "type": "time",
        "label": "Hora Inicio",
        "required": true
      },
      {
        "id": "hora_final",
        "type": "time",
        "label": "Hora Final",
        "required": false
      }
    ]
  },
  {
    "id": "sistema_revisado",
    "title": "Sistema Revisado",
    "order": 1,
    "fields": [
      {
        "id": "sistemas",
        "type": "multiSelect",
        "label": "Sistema(s) revisado(s)",
        "required": true,
        "options": [
          "Control Acceso",
          "CCTV",
          "UPS",
          "Alarma",
          "Red Datos",
          "Red Energía",
          "Otro"
        ]
      },
      {
        "id": "sistema_otro_descripcion",
        "type": "text",
        "label": "Descripción del otro sistema",
        "required": false
      }
    ]
  },
  {
    "id": "diagnostico",
    "title": "Diagnóstico Técnico",
    "order": 2,
    "fields": [
      {
        "id": "estado_inicial",
        "type": "textarea",
        "label": "Estado Inicial",
        "required": true,
        "hint": "Describe el estado en que se encontró el equipo/sistema"
      },
      {
        "id": "diagnostico",
        "type": "textarea",
        "label": "Diagnóstico",
        "required": true,
        "hint": "Describe el diagnóstico realizado"
      },
      {
        "id": "correccion",
        "type": "textarea",
        "label": "Corrección",
        "required": false,
        "hint": "Describe la corrección aplicada"
      }
    ]
  },
  {
    "id": "resultado",
    "title": "Resultado del Servicio",
    "order": 3,
    "fields": [
      {
        "id": "solucionado",
        "type": "select",
        "label": "Estado de la solución",
        "required": true,
        "options": [
          "Totalmente solucionado",
          "Parcialmente solucionado",
          "No solucionado",
          "Solucionado remotamente",
          "Reprogramar visita"
        ]
      },
      {
        "id": "se_emplearon_materiales",
        "type": "boolean",
        "label": "¿Se emplearon materiales o equipos?",
        "required": true
      },
      {
        "id": "descripcion_materiales",
        "type": "textarea",
        "label": "Descripción de materiales/equipos empleados",
        "required": false,
        "hint": "Cantidad, referencia, modelo, serial, etc."
      }
    ]
  },
  {
    "id": "observaciones_adicionales",
    "title": "Observaciones Adicionales",
    "order": 4,
    "fields": [
      {
        "id": "observaciones_adicionales",
        "type": "textarea",
        "label": "Observaciones adicionales",
        "required": false
      },
      {
        "id": "nombre_tecnico",
        "type": "text",
        "label": "Nombre del técnico que asistió",
        "required": true
      },
      {
        "id": "nombre_acompanante",
        "type": "text",
        "label": "Nombre acompañante (cliente)",
        "required": false
      },
      {
        "id": "nombre_supervisor",
        "type": "text",
        "label": "Supervisado/validado por",
        "required": false
      }
    ]
  }
]$tpl$::jsonb, TRUE),
    -- Informe Técnico UPS (CDP) (asset: ups_cdp_v1)
    ('10000000-0000-4000-8000-000000000005', 'Informe Técnico UPS (CDP)', 'ups', 1,
     $tpl$[
  {
    "id": "encabezado",
    "title": "Encabezado del Informe",
    "order": 0,
    "fields": [
      {
        "id": "ticket_no",
        "type": "text",
        "label": "Ticket No.",
        "required": false
      },
      {
        "id": "os_numero",
        "type": "text",
        "label": "O.S. No.",
        "required": false
      },
      {
        "id": "tipo_servicio",
        "type": "multiSelect",
        "label": "Tipo de Servicio",
        "required": true,
        "options": [
          "Instalación",
          "Overhaul",
          "Correctivo",
          "Preventivo",
          "Cambio Baterías"
        ]
      },
      {
        "id": "cliente",
        "type": "text",
        "label": "Cliente",
        "required": true
      },
      {
        "id": "fecha",
        "type": "date",
        "label": "Fecha",
        "required": true
      },
      {
        "id": "ciudad",
        "type": "text",
        "label": "Ciudad",
        "required": false
      },
      {
        "id": "oficina",
        "type": "text",
        "label": "Oficina",
        "required": false
      },
      {
        "id": "encargado",
        "type": "text",
        "label": "Encargado",
        "required": false
      },
      {
        "id": "telefono",
        "type": "text",
        "label": "Teléfono",
        "required": false
      },
      {
        "id": "ingeniero_tecnico",
        "type": "text",
        "label": "Ingeniero/Técnico",
        "required": false
      }
    ]
  },
  {
    "id": "identificacion_equipo",
    "title": "Identificación del Equipo",
    "order": 1,
    "fields": [
      {
        "id": "capacidad",
        "type": "text",
        "label": "Capacidad",
        "required": false
      },
      {
        "id": "marca",
        "type": "text",
        "label": "Marca",
        "required": false
      },
      {
        "id": "modelo",
        "type": "text",
        "label": "Modelo",
        "required": false
      },
      {
        "id": "serial",
        "type": "text",
        "label": "Serial",
        "required": false
      },
      {
        "id": "no_sim_card",
        "type": "text",
        "label": "No. de SIM Card",
        "required": false
      }
    ]
  },
  {
    "id": "diagnostico",
    "title": "Diagnóstico",
    "order": 2,
    "fields": [
      {
        "id": "dano_reportado",
        "type": "textarea",
        "label": "Daño reportado por el cliente",
        "required": false
      },
      {
        "id": "estado_inicial",
        "type": "textarea",
        "label": "Estado inicial del equipo",
        "required": false
      }
    ]
  },
  {
    "id": "estado_conexion",
    "title": "Estado de la Conexión",
    "order": 3,
    "fields": [
      {
        "id": "tablero_electrico",
        "type": "text",
        "label": "Tablero Eléctrico",
        "required": false
      },
      {
        "id": "tomas_clavijas",
        "type": "text",
        "label": "Tomas y clavijas",
        "required": false
      },
      {
        "id": "barrajes",
        "type": "text",
        "label": "Barrajes",
        "required": false
      },
      {
        "id": "breakers",
        "type": "text",
        "label": "Breakers",
        "required": false
      },
      {
        "id": "bypass_externo",
        "type": "text",
        "label": "Bypass Externo",
        "required": false
      },
      {
        "id": "rack_baterias",
        "type": "text",
        "label": "Rack de Baterías",
        "required": false
      }
    ]
  },
  {
    "id": "acometida",
    "title": "Acometida",
    "order": 4,
    "fields": [
      {
        "id": "voltaje_f1_fnac",
        "type": "decimal",
        "label": "Voltaje F-NAC F1 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "voltaje_f2_fnac",
        "type": "decimal",
        "label": "Voltaje F-NAC F2 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "voltaje_f3_fnac",
        "type": "decimal",
        "label": "Voltaje F-NAC F3 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "corriente_entrada_f1",
        "type": "decimal",
        "label": "Corriente entrada F1 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "corriente_entrada_f2",
        "type": "decimal",
        "label": "Corriente entrada F2 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "corriente_entrada_f3",
        "type": "decimal",
        "label": "Corriente entrada F3 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "n_tac",
        "type": "decimal",
        "label": "N-TAC (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "f_f",
        "type": "decimal",
        "label": "F-F (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "neutro_aislado",
        "type": "boolean",
        "label": "Neutro Aislado",
        "required": false
      },
      {
        "id": "hz",
        "type": "decimal",
        "label": "HZ",
        "required": false,
        "unit": "Hz"
      }
    ]
  },
  {
    "id": "pruebas_equipo",
    "title": "Pruebas del Equipo",
    "order": 5,
    "fields": [
      {
        "id": "voltaje_flotacion_f1",
        "type": "decimal",
        "label": "Voltaje flotación F1 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "voltaje_flotacion_f2",
        "type": "decimal",
        "label": "Voltaje flotación F2 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "voltaje_flotacion_f3",
        "type": "decimal",
        "label": "Voltaje flotación F3 (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "voltaje_salida_ff",
        "type": "decimal",
        "label": "Voltaje salida F-F (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "corriente_salida_f1",
        "type": "decimal",
        "label": "Corriente salida F1 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "corriente_salida_f2",
        "type": "decimal",
        "label": "Corriente salida F2 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "corriente_salida_f3",
        "type": "decimal",
        "label": "Corriente salida F3 (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "porcentaje_carga",
        "type": "decimal",
        "label": "Porcentaje de carga (%)",
        "required": false,
        "unit": "%"
      },
      {
        "id": "hz_salida",
        "type": "decimal",
        "label": "HZ salida",
        "required": false,
        "unit": "Hz"
      },
      {
        "id": "queda_funcionando",
        "type": "boolean",
        "label": "¿Queda funcionando?",
        "required": true
      },
      {
        "id": "limpieza_equipo",
        "type": "select",
        "label": "Limpieza del equipo",
        "required": false,
        "options": [
          "Realizada",
          "No realizada",
          "Parcial"
        ]
      },
      {
        "id": "limpieza_baterias",
        "type": "select",
        "label": "Limpieza de baterías",
        "required": false,
        "options": [
          "Realizada",
          "No realizada",
          "Parcial"
        ]
      },
      {
        "id": "soporte_equipo_carga",
        "type": "select",
        "label": "Soporte del equipo con carga",
        "required": false,
        "options": [
          "Soporta",
          "No soporta",
          "Parcial"
        ]
      },
      {
        "id": "bypass_equipo",
        "type": "select",
        "label": "Bypass del equipo",
        "required": false,
        "options": [
          "Funciona",
          "No funciona",
          "No aplica"
        ]
      },
      {
        "id": "estado_final",
        "type": "textarea",
        "label": "Estado final del equipo",
        "required": false
      }
    ]
  },
  {
    "id": "causas_correctivo",
    "title": "Causas del Correctivo",
    "order": 6,
    "fields": [
      {
        "id": "causas",
        "type": "multiSelect",
        "label": "Causas del correctivo",
        "required": false,
        "options": [
          "Breakers",
          "Bypass externo",
          "Bypass interno",
          "Cargador (control)",
          "Cargador (potencial)",
          "Inversor (control)",
          "Inversor (potencial)",
          "Baterías",
          "Ventiladores",
          "Externo",
          "Otros"
        ]
      },
      {
        "id": "descripcion_causa",
        "type": "textarea",
        "label": "Descripción detallada de la causa",
        "required": false
      }
    ]
  },
  {
    "id": "informe_baterias",
    "title": "Informe de Baterías",
    "order": 7,
    "fields": [
      {
        "id": "marca_bateria",
        "type": "text",
        "label": "Marca",
        "required": false
      },
      {
        "id": "referencia_bateria",
        "type": "text",
        "label": "Referencia",
        "required": false
      },
      {
        "id": "cantidad_baterias",
        "type": "number",
        "label": "Cantidad",
        "required": false
      },
      {
        "id": "voltaje_bateria",
        "type": "decimal",
        "label": "Voltaje (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "ah_bateria",
        "type": "decimal",
        "label": "AH",
        "required": false,
        "unit": "Ah"
      },
      {
        "id": "estacionaria",
        "type": "boolean",
        "label": "¿Estacionaria?",
        "required": false
      },
      {
        "id": "selladas",
        "type": "boolean",
        "label": "¿Selladas?",
        "required": false
      },
      {
        "id": "estado_bateria",
        "type": "select",
        "label": "Estado",
        "required": false,
        "options": [
          "Bueno",
          "Regular",
          "Deficiente",
          "Requiere cambio"
        ]
      },
      {
        "id": "no_bancos",
        "type": "number",
        "label": "No. de Bancos",
        "required": false
      },
      {
        "id": "conexiones_bateria",
        "type": "text",
        "label": "Conexiones",
        "required": false
      },
      {
        "id": "estado_bornes",
        "type": "select",
        "label": "Estado de bornes",
        "required": false,
        "options": [
          "Bueno",
          "Regular",
          "Oxidado",
          "Requiere limpieza"
        ]
      }
    ]
  },
  {
    "id": "trabajo_observaciones",
    "title": "Trabajo Realizado y Observaciones",
    "order": 8,
    "fields": [
      {
        "id": "trabajo_realizado",
        "type": "textarea",
        "label": "Describa el trabajo realizado",
        "required": true
      },
      {
        "id": "observaciones_recomendaciones",
        "type": "textarea",
        "label": "Observaciones técnicas / Recomendaciones",
        "required": false
      },
      {
        "id": "hora_entrada",
        "type": "time",
        "label": "Hora de entrada",
        "required": false
      },
      {
        "id": "hora_salida",
        "type": "time",
        "label": "Hora de salida",
        "required": false
      },
      {
        "id": "nombre_ingeniero",
        "type": "text",
        "label": "Nombre del Ingeniero/Técnico",
        "required": true
      },
      {
        "id": "nombre_cliente_firma",
        "type": "text",
        "label": "Nombre y Sello del Cliente",
        "required": false
      },
      {
        "id": "revisado_por",
        "type": "text",
        "label": "Revisado por",
        "required": false
      }
    ]
  }
]$tpl$::jsonb, TRUE),
    -- Inspección de Infraestructura (asset: infraestructura_v1)
    ('10000000-0000-4000-8000-000000000001', 'Inspección de Infraestructura', 'infraestructura', 1,
     $tpl$[
  {
    "id": "general",
    "title": "Información General",
    "order": 0,
    "fields": [
      {
        "id": "ubicacion",
        "type": "text",
        "label": "Ubicación exacta",
        "required": true,
        "hint": "Descripción detallada del sitio"
      },
      {
        "id": "descripcion",
        "type": "textarea",
        "label": "Descripción general",
        "required": true
      },
      {
        "id": "acceso",
        "type": "select",
        "label": "Tipo de acceso",
        "required": true,
        "options": [
          "Libre",
          "Controlado",
          "Restringido",
          "Con escolta"
        ]
      },
      {
        "id": "condicion_sitio",
        "type": "select",
        "label": "Condición del sitio",
        "required": true,
        "options": [
          "Excelente",
          "Bueno",
          "Regular",
          "Deficiente",
          "Crítico"
        ]
      }
    ]
  },
  {
    "id": "medidas",
    "title": "Medidas y Dimensiones",
    "order": 1,
    "fields": [
      {
        "id": "largo",
        "type": "decimal",
        "label": "Largo (m)",
        "required": false,
        "unit": "m"
      },
      {
        "id": "ancho",
        "type": "decimal",
        "label": "Ancho (m)",
        "required": false,
        "unit": "m"
      },
      {
        "id": "alto",
        "type": "decimal",
        "label": "Alto (m)",
        "required": false,
        "unit": "m"
      },
      {
        "id": "area_total",
        "type": "decimal",
        "label": "Área total (m²)",
        "required": false,
        "unit": "m²"
      }
    ]
  },
  {
    "id": "observaciones",
    "title": "Observaciones",
    "order": 2,
    "fields": [
      {
        "id": "observaciones_generales",
        "type": "textarea",
        "label": "Observaciones generales",
        "required": false
      },
      {
        "id": "requiere_intervencion",
        "type": "boolean",
        "label": "¿Requiere intervención inmediata?",
        "required": true
      },
      {
        "id": "prioridad",
        "type": "select",
        "label": "Prioridad",
        "required": false,
        "options": [
          "Baja",
          "Media",
          "Alta",
          "Urgente"
        ]
      }
    ]
  }
]$tpl$::jsonb, TRUE),
    -- Inspección de Energía (asset: energia_v1)
    ('10000000-0000-4000-8000-000000000002', 'Inspección de Energía', 'energia', 1,
     $tpl$[
  {
    "id": "instalacion",
    "title": "Datos de la Instalación",
    "order": 0,
    "fields": [
      {
        "id": "tipo_instalacion",
        "type": "select",
        "label": "Tipo de instalación",
        "required": true,
        "options": [
          "Residencial",
          "Comercial",
          "Industrial",
          "Corporativa"
        ]
      },
      {
        "id": "voltaje_entrada",
        "type": "decimal",
        "label": "Voltaje de entrada (V)",
        "required": true,
        "unit": "V"
      },
      {
        "id": "voltaje_salida",
        "type": "decimal",
        "label": "Voltaje de salida (V)",
        "required": false,
        "unit": "V"
      },
      {
        "id": "corriente_nominal",
        "type": "decimal",
        "label": "Corriente nominal (A)",
        "required": false,
        "unit": "A"
      },
      {
        "id": "frecuencia",
        "type": "select",
        "label": "Frecuencia",
        "required": false,
        "options": [
          "50 Hz",
          "60 Hz"
        ]
      },
      {
        "id": "fases",
        "type": "select",
        "label": "Número de fases",
        "required": true,
        "options": [
          "Monofásico",
          "Bifásico",
          "Trifásico"
        ]
      }
    ]
  },
  {
    "id": "estado",
    "title": "Estado del Sistema",
    "order": 1,
    "fields": [
      {
        "id": "estado_tablero",
        "type": "select",
        "label": "Estado del tablero eléctrico",
        "required": true,
        "options": [
          "Bueno",
          "Regular",
          "Deficiente",
          "Requiere reemplazo"
        ]
      },
      {
        "id": "tiene_tierra",
        "type": "boolean",
        "label": "¿Tiene puesta a tierra?",
        "required": true
      },
      {
        "id": "tiene_protecciones",
        "type": "boolean",
        "label": "¿Tiene protecciones (breakers/fusibles)?",
        "required": true
      },
      {
        "id": "tiene_polo_neutro",
        "type": "boolean",
        "label": "¿Tiene polo neutro?",
        "required": false
      },
      {
        "id": "tipo_cable",
        "type": "select",
        "label": "Tipo de cable predominante",
        "required": false,
        "options": [
          "Thhn",
          "Thw",
          "NMB",
          "Concéntrico",
          "Otro"
        ]
      }
    ]
  },
  {
    "id": "observaciones",
    "title": "Observaciones",
    "order": 2,
    "fields": [
      {
        "id": "anomalias",
        "type": "textarea",
        "label": "Anomalías detectadas",
        "required": false
      },
      {
        "id": "observaciones_tecnicas",
        "type": "textarea",
        "label": "Observaciones técnicas",
        "required": false
      },
      {
        "id": "requiere_intervencion",
        "type": "boolean",
        "label": "¿Requiere intervención?",
        "required": true
      }
    ]
  }
]$tpl$::jsonb, TRUE),
    -- Inspección de Datos / Red (asset: datos_v1)
    ('10000000-0000-4000-8000-000000000003', 'Inspección de Datos / Red', 'datos', 1,
     $tpl$[
  {
    "id": "red",
    "title": "Datos de la Red",
    "order": 0,
    "fields": [
      {
        "id": "tipo_red",
        "type": "select",
        "label": "Tipo de red",
        "required": true,
        "options": [
          "LAN",
          "WAN",
          "Fibra óptica",
          "Inalámbrica",
          "Híbrida"
        ]
      },
      {
        "id": "tipo_cableado",
        "type": "select",
        "label": "Tipo de cableado",
        "required": true,
        "options": [
          "Cat5e",
          "Cat6",
          "Cat6A",
          "Cat7",
          "Fibra OM1",
          "Fibra OM2",
          "Fibra OM3",
          "Fibra OM4",
          "Fibra OS1",
          "Fibra OS2"
        ]
      },
      {
        "id": "longitud_total",
        "type": "decimal",
        "label": "Longitud total de cableado (m)",
        "required": false,
        "unit": "m"
      },
      {
        "id": "cantidad_puntos",
        "type": "number",
        "label": "Cantidad de puntos de red",
        "required": false
      },
      {
        "id": "switch_modelo",
        "type": "text",
        "label": "Modelo de switch principal",
        "required": false
      }
    ]
  },
  {
    "id": "conectividad",
    "title": "Conectividad",
    "order": 1,
    "fields": [
      {
        "id": "velocidad_contratada",
        "type": "text",
        "label": "Velocidad contratada",
        "required": false
      },
      {
        "id": "velocidad_real_bajada",
        "type": "decimal",
        "label": "Velocidad real bajada (Mbps)",
        "required": false,
        "unit": "Mbps"
      },
      {
        "id": "velocidad_real_subida",
        "type": "decimal",
        "label": "Velocidad real subida (Mbps)",
        "required": false,
        "unit": "Mbps"
      },
      {
        "id": "latencia",
        "type": "decimal",
        "label": "Latencia (ms)",
        "required": false,
        "unit": "ms"
      },
      {
        "id": "proveedor",
        "type": "text",
        "label": "Proveedor de internet",
        "required": false
      }
    ]
  },
  {
    "id": "observaciones",
    "title": "Observaciones",
    "order": 2,
    "fields": [
      {
        "id": "problemas_detectados",
        "type": "textarea",
        "label": "Problemas detectados",
        "required": false
      },
      {
        "id": "observaciones_tecnicas",
        "type": "textarea",
        "label": "Observaciones técnicas",
        "required": false
      },
      {
        "id": "requiere_intervencion",
        "type": "boolean",
        "label": "¿Requiere intervención?",
        "required": true
      }
    ]
  }
]$tpl$::jsonb, TRUE)
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    visit_type    = EXCLUDED.visit_type,
    version       = EXCLUDED.version,
    sections_json = EXCLUDED.sections_json,
    is_active     = EXCLUDED.is_active;

-- ── Catálogo de materiales ───────────────────────────────────────────────────
INSERT INTO public.material_catalog (id, code, name, description, unit, category, is_active) VALUES
    ('40000000-0000-4000-8000-000000000001', 'CABLE-UTP-CAT6',  'Cable UTP Cat6',              'Cable de red UTP categoría 6, 23 AWG',               'metro',  'Cableado',       TRUE),
    ('40000000-0000-4000-8000-000000000002', 'CABLE-THHN-12',   'Cable THHN #12 AWG',          'Cable eléctrico THHN calibre 12',                    'metro',  'Cableado',       TRUE),
    ('40000000-0000-4000-8000-000000000003', 'CABLE-THHN-10',   'Cable THHN #10 AWG',          'Cable eléctrico THHN calibre 10',                    'metro',  'Cableado',       TRUE),
    ('40000000-0000-4000-8000-000000000004', 'FIBRA-SM-OS2',    'Fibra óptica OS2 monomodo',   'Fibra óptica monomodo OS2 para exteriores',          'metro',  'Cableado',       TRUE),
    ('40000000-0000-4000-8000-000000000005', 'CONEC-RJ45-CAT6', 'Conector RJ45 Cat6',          'Conector macho RJ45 para cable Cat6',                'unidad', 'Conectores',     TRUE),
    ('40000000-0000-4000-8000-000000000006', 'CONEC-LC-SM',     'Conector LC monomodo',        'Conector LC/UPC para fibra monomodo',                'unidad', 'Conectores',     TRUE),
    ('40000000-0000-4000-8000-000000000007', 'TUBO-EMT-3/4',    'Tubería EMT 3/4"',            'Tubería metálica EMT para instalaciones eléctricas', 'metro',  'Tubería',        TRUE),
    ('40000000-0000-4000-8000-000000000008', 'CANALETA-40X25',  'Canaleta 40×25 mm',           'Canaleta plástica para cable de red 40×25mm',        'metro',  'Tubería',        TRUE),
    ('40000000-0000-4000-8000-000000000009', 'BREAKER-1P-20A',  'Breaker 1P 20A',              'Interruptor termomagnético 1 polo 20 amperios',      'unidad', 'Protecciones',   TRUE),
    ('40000000-0000-4000-8000-000000000010', 'BREAKER-2P-30A',  'Breaker 2P 30A',              'Interruptor termomagnético 2 polos 30 amperios',     'unidad', 'Protecciones',   TRUE),
    ('40000000-0000-4000-8000-000000000011', 'PATCH-PANEL-24',  'Patch panel 24 puertos Cat6', 'Panel de parcheo 24 puertos Cat6 1U',                'unidad', 'Equipos de red', TRUE),
    ('40000000-0000-4000-8000-000000000012', 'KEYSTONE-CAT6',   'Keystone Jack Cat6',          'Módulo keystone hembra Cat6',                        'unidad', 'Equipos de red', TRUE),
    ('40000000-0000-4000-8000-000000000013', 'ABRAZA-3/4',      'Abrazadera 3/4"',             'Abrazadera metálica para tubería 3/4"',              'unidad', 'Fijación',       TRUE),
    ('40000000-0000-4000-8000-000000000014', 'BRIDA-NEGRO',     'Brida nylon 300mm',           'Brida de amarre de nylon negra 300mm',               'unidad', 'Fijación',       TRUE)
ON CONFLICT (code) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    unit        = EXCLUDED.unit,
    category    = EXCLUDED.category,
    is_active   = EXCLUDED.is_active;

-- ── Perfiles demo (solo si existen los usuarios en auth.users) ──────────────
-- El trigger handle_new_user ya crea el perfil al crear el usuario; aquí se
-- completan nombre, teléfono y rol. Si el usuario no existe, no se inserta nada.
INSERT INTO public.profiles (id, email, full_name, role, phone, is_active)
SELECT u.id, d.email, d.full_name, d.role::public.user_role, d.phone, TRUE
FROM (VALUES
    ('tecnico@teins.com', 'Carlos Técnico Demo', 'technician', '+57-300-000-0101'),
    ('oficina@teins.com', 'Ana Oficina Demo',    'office',     '+57-300-000-0102')
) AS d(email, full_name, role, phone)
JOIN auth.users u ON lower(u.email) = d.email
ON CONFLICT (id) DO UPDATE SET
    email     = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role      = EXCLUDED.role,
    phone     = EXCLUDED.phone,
    is_active = TRUE;

-- ── Visitas demo del técnico (solo si existe tecnico@teins.com) ─────────────
-- ON CONFLICT DO NOTHING: re-ejecutar el seed no pisa el avance del técnico.
INSERT INTO public.visits (
    id, technician_id, title, visit_type, address, status, sync_status,
    form_template_id, form_template_version, client_name, description, created_at
)
SELECT v.id::uuid, p.id, v.title, v.visit_type, v.address,
       v.status::public.visit_status, 'synced'::public.sync_status,
       v.template_id::uuid, 1, v.client_name, v.description, NOW() - v.age::interval
FROM (VALUES
    ('20000000-0000-4000-8000-000000000001',
     'VT-00001 — Inspección Infraestructura Almacén Sur', 'infraestructura',
     'Calle Industrial 123, Zona Sur', 'assigned',
     '10000000-0000-4000-8000-000000000001', 'Almacenes ABC S.A.',
     'Revisión completa de infraestructura del almacén zona sur.', '2 days'),
    ('20000000-0000-4000-8000-000000000002',
     'VT-00002 — Inspección Energía Planta Norte', 'energia',
     'Av. Industrial Norte 456, Parque Industrial', 'inProgress',
     '10000000-0000-4000-8000-000000000002', 'Industrias XYZ Ltda.',
     'Inspección del sistema eléctrico planta de producción.', '1 day'),
    ('20000000-0000-4000-8000-000000000003',
     'VT-00003 — Instalación Red Datos Oficinas Centrales', 'datos',
     'Torre Empresarial, Piso 8, Centro', 'assigned',
     '10000000-0000-4000-8000-000000000003', 'Corporación DEF',
     'Instalación y certificación de red Cat6 en 3 pisos.', '3 hours')
) AS v(id, title, visit_type, address, status, template_id, client_name, description, age)
CROSS JOIN public.profiles p
WHERE p.email = 'tecnico@teins.com' AND p.role = 'technician'
ON CONFLICT (id) DO NOTHING;
