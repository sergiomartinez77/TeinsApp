import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { visitFromRow } from '@/models/visit.model';

import { CreateVisitDialog } from '../components/CreateVisitDialog';
import { SectionGrid, VISIT_SECTIONS } from '../components/SectionGrid';
import { VisitActionBar } from '../components/VisitActionBar';
import { VisitCard } from '../components/VisitCard';
import { VisitFilterTabs } from '../components/VisitFilterTabs';
import { VisitInfoCard } from '../components/VisitInfoCard';

const visit = visitFromRow({
  id: 'v1',
  technician_id: 't1',
  title: 'VT-00001 — Almacén Sur',
  client_name: 'Almacenes ABC',
  address: 'Calle Industrial 123',
  visit_type: 'infraestructura',
  status: 'inProgress',
  sync_status: 'pendingSync',
  created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  started_at: new Date(2026, 4, 10, 9, 30).toISOString(),
});

describe('VisitCard', () => {
  it('muestra los datos de la visita y la abre al pulsar', async () => {
    const onPress = jest.fn();
    await render(<VisitCard visit={visit} onPress={onPress} />);

    expect(screen.getByText('En progreso')).toBeOnTheScreen();
    expect(screen.getByText('Inspección de Infraestructura')).toBeOnTheScreen();
    expect(screen.getByText('Almacenes ABC')).toBeOnTheScreen();
    expect(screen.getByText('Creada hace 3 h')).toBeOnTheScreen();
    expect(screen.getByText('Por sincronizar')).toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Abrir visita VT-00001 — Almacén Sur' }),
    );
    expect(onPress).toHaveBeenCalledWith('v1');
  });

  it('no muestra el aviso de sincronización si la visita ya está sincronizada', async () => {
    await render(<VisitCard visit={{ ...visit, syncStatus: 'synced' }} onPress={jest.fn()} />);

    expect(screen.queryByText('Por sincronizar')).toBeNull();
  });
});

describe('VisitInfoCard', () => {
  it('muestra tipo, cliente, dirección, fechas y estado de sincronización', async () => {
    await render(<VisitInfoCard visit={visit} />);

    expect(screen.getByRole('header', { name: 'VT-00001 — Almacén Sur' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Cliente: Almacenes ABC')).toBeOnTheScreen();
    expect(screen.getByLabelText('Dirección: Calle Industrial 123')).toBeOnTheScreen();
    expect(screen.getByLabelText('Iniciada: 10 may 2026, 09:30')).toBeOnTheScreen();
    expect(screen.queryByText('Finalizada')).toBeNull();
    expect(screen.getByText('Por sincronizar')).toBeOnTheScreen();
  });
});

describe('VisitFilterTabs', () => {
  it('marca la pestaña activa y avisa del cambio', async () => {
    const onChange = jest.fn();
    await render(<VisitFilterTabs value="all" onChange={onChange} />);

    expect(screen.getByRole('tab', { name: 'Todas' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Completadas' })).not.toBeSelected();

    await fireEvent.press(screen.getByRole('tab', { name: 'En progreso' }));
    expect(onChange).toHaveBeenCalledWith('inProgress');
  });
});

describe('VisitActionBar', () => {
  const handlers = () => ({ onStart: jest.fn(), onComplete: jest.fn() });

  it('ofrece "Iniciar visita" si está asignada', async () => {
    const h = handlers();
    await render(<VisitActionBar status="assigned" isBusy={false} {...h} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar visita' }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Finalizar visita' })).toBeNull();
  });

  it('ofrece "Finalizar visita" si está en progreso', async () => {
    const h = handlers();
    await render(<VisitActionBar status="inProgress" isBusy={false} {...h} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Finalizar visita' }));
    expect(h.onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'pendingReview', 'synced'] as const)(
    'no ofrece acciones si está %s',
    async (status) => {
      await render(<VisitActionBar status={status} isBusy={false} {...handlers()} />);
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('bloquea el botón mientras se guarda', async () => {
    const h = handlers();
    await render(<VisitActionBar status="assigned" isBusy {...h} />);

    await fireEvent.press(screen.getByTestId('visit-start'));
    expect(h.onStart).not.toHaveBeenCalled();
  });
});

describe('SectionGrid', () => {
  it('ofrece las cinco secciones de la visita', async () => {
    const onOpen = jest.fn();
    await render(<SectionGrid onOpen={onOpen} />);

    expect(VISIT_SECTIONS.map((section) => section.label)).toEqual([
      'Formulario técnico',
      'Materiales',
      'Fotografías',
      'Planos',
      'Resumen',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Materiales' }));
    expect(onOpen).toHaveBeenCalledWith('materials');
  });
});

describe('CreateVisitDialog', () => {
  const setup = (overrides: Partial<Parameters<typeof CreateVisitDialog>[0]> = {}) => {
    const props = {
      visible: true,
      onDismiss: jest.fn(),
      onSubmit: jest.fn(),
      isSubmitting: false,
      ...overrides,
    };
    return { props, view: render(<CreateVisitDialog {...props} />) };
  };

  it('no crea la visita sin título y muestra el error', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Crear visita' }));

    expect(await screen.findByText('Escribe un título para la visita.')).toBeOnTheScreen();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('envía los datos normalizados', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.changeText(
      screen.getByLabelText('Título, obligatorio'),
      '  Tablero principal ',
    );
    await fireEvent.changeText(screen.getByLabelText('Dirección'), 'Av. Norte 456');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear visita' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(jest.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
      title: 'Tablero principal',
      visitType: 'general',
      address: 'Av. Norte 456',
      description: null,
    });
  });

  it('permite elegir el tipo de visita', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Título, obligatorio'), 'UPS sala 2');
    await fireEvent.press(screen.getByRole('combobox', { name: 'Tipo de visita, obligatorio' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Informe Técnico UPS (CDP)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Crear visita' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(jest.mocked(props.onSubmit).mock.calls[0]?.[0]).toMatchObject({ visitType: 'ups' });
  });

  it('muestra el error de guardado y permite cancelar', async () => {
    const { props, view } = setup({ error: 'Error al acceder a los datos locales.' });
    await view;

    expect(screen.getByText('Error al acceder a los datos locales.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});
