import { h } from '../dom';

export interface RadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export function radioGroup<T extends string>(
  legend: string,
  name: string,
  options: readonly RadioOption<T>[],
  selected: T,
  onChange: (value: T) => void,
  compact = false,
): HTMLFieldSetElement {
  return h(
    'fieldset',
    { class: 'radio-cards' },
    h('legend', null, legend),
    h(
      'div',
      { class: compact ? 'radio-grid radio-grid--compact' : 'radio-grid' },
      options.map((o) =>
        h(
          'label',
          { class: 'radio-card' },
          h('input', {
            type: 'radio',
            name,
            value: o.value,
            checked: o.value === selected,
            disabled: o.disabled ?? false,
            onchange: () => onChange(o.value),
          }),
          h(
            'span',
            { class: 'radio-card-body' },
            h('span', { class: 'radio-card-label' }, o.label),
            o.hint ? h('span', { class: 'radio-card-hint' }, o.hint) : null,
          ),
        ),
      ),
    ),
  );
}
