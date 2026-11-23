import { fireEvent, render, screen } from '@testing-library/react-native';

import { SectionLinks } from '../components/SectionLinks';
import type { SectionStatuses } from '../services/visit-summary';

const STATUSES: SectionStatuses = {
  'form-select': 'En curso · Revisión eléctrica',
  materials: '2 materiales · 15 metro',
  photos: '3 fotografías · 1 por subir',
  annotations: 'No disponible',
};

describe('SectionLinks', () => {
  it('muestra las cuatro secciones con su estado', async () => {
    await render(<SectionLinks statuses={STATUSES} onOpen={jest.fn()} />);

    for (const label of ['Formulario técnico', 'Materiales', 'Fotografías', 'Planos']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    for (const status of Object.values(STATUSES)) {
      expect(screen.getByText(status)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Materiales: 2 materiales · 15 metro')).toBeOnTheScreen();
  });

  it('no incluye la sección "Resumen"', async () => {
    await render(<SectionLinks statuses={STATUSES} onOpen={jest.fn()} />);

    expect(screen.queryByText('Resumen')).toBeNull();
    expect(screen.queryByTestId('section-link-summary')).toBeNull();
  });

  it('cada fila avisa de su clave al pulsarla', async () => {
    const onOpen = jest.fn();
    await render(<SectionLinks statuses={STATUSES} onOpen={onOpen} />);

    for (const key of ['form-select', 'materials', 'photos', 'annotations'] as const) {
      fireEvent.press(screen.getByTestId(`section-link-${key}`));
      expect(onOpen).toHaveBeenLastCalledWith(key);
    }
    expect(onOpen).toHaveBeenCalledTimes(4);
  });
});
