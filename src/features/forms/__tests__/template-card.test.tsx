import { fireEvent, render, screen } from '@testing-library/react-native';

import { templateFromAsset } from '@/models/form.model';

import { TemplateCard } from '../components/TemplateCard';

const template = (() => {
  const parsed = templateFromAsset({
    id: 'prueba_v1',
    name: 'Inspección de prueba',
    visit_type: 'general',
    version: 1,
    sections: [
      { id: 's1', title: 'Uno', order: 0, fields: [{ id: 'a', type: 'text', label: 'A' }] },
      {
        id: 's2',
        title: 'Dos',
        order: 1,
        fields: [
          { id: 'b', type: 'text', label: 'B' },
          { id: 'c', type: 'number', label: 'C' },
        ],
      },
    ],
  });
  if (!parsed) throw new Error('plantilla de prueba inválida');
  return parsed;
})();

describe('TemplateCard', () => {
  it('muestra secciones y campos, marca la recomendada y avisa al pulsarla', async () => {
    const onPress = jest.fn();
    await render(<TemplateCard template={template} recommended onPress={onPress} />);

    expect(screen.getByText('2 secciones · 3 campos')).toBeOnTheScreen();
    expect(screen.getByText('Recomendado')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByLabelText('Inspección de prueba, 2 secciones, 3 campos, recomendado'),
    );
    expect(onPress).toHaveBeenCalledWith('prueba_v1');
  });

  it('usa el singular y no marca las demás como recomendadas', async () => {
    const single = { ...template, sections: template.sections.slice(0, 1) };
    await render(<TemplateCard template={single} recommended={false} onPress={jest.fn()} />);

    expect(screen.getByText('1 sección · 1 campo')).toBeOnTheScreen();
    expect(screen.queryByText('Recomendado')).toBeNull();
  });
});
