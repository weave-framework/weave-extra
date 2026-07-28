/**
 * The column configuration — the shape of the JSON files a grid is authored in, and the one place
 * that turns it into something the rest of the plugin can rely on.
 *
 * The configs this replaces were typed as `type?: any` with the per-type keys undeclared, so the only
 * way to learn the format was to read the switch statements that consumed it. Half the keys in real
 * use (`enum`, `multiple`, `filterType`, `hideFalseIcon`, `trueValue`, …) appeared in no interface at
 * all. Here the base is declared, the built-in types declare what they additionally require, and a
 * custom type carries whatever it likes under `options` — checked, not guessed.
 *
 * Validation happens ONCE, at construction, and throws with every problem it found. A typo'd `type`
 * used to fall through to a default renderer and show a blank column: fifteen silent blanks are worse
 * than one loud failure at startup.
 */

import type { ColumnAvailability, ResolvedColumn } from './contract.js';

/** Keys every column may carry, whatever its type. */
export interface ColumnConfigBase {
  /** Field name in the row, and the column's stable id. */
  name: string;
  /** Header text, or a translation key when `translate` is set. */
  title?: string;
  /** Translate `title` (and a `tooltip`) through the configured translator. */
  translate?: boolean;
  /** Start visible. Default `true`. */
  visible?: boolean;
  /** Render, but do not offer in the columns menu — the user cannot switch it off. */
  hideInMenu?: boolean;
  /** Do not render at all. The field stays available to other columns that read it. */
  hidden?: boolean;
  /** Column width. A number is px. */
  width?: string | number;
  /** Cell alignment. `left`/`right` are accepted and mapped to the logical values. */
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
  /** Disable sorting on this column. */
  sortdisabled?: boolean;
  /** Disable the filter control for this column. */
  searchDisabled?: boolean;
  /** Allow the user to drag this column's width. */
  resizable?: boolean;
  /** Header tooltip, or a key when `translate` is set. */
  tooltip?: string;
}

export interface StringColumnConfig extends ColumnConfigBase {
  type: 'string' | 'text';
}

export interface NumberColumnConfig extends ColumnConfigBase {
  type: 'number' | 'integer';
}

export interface TimestampColumnConfig extends ColumnConfigBase {
  type: 'timestamp';
  /** Passed through to the configured `formatDate`. */
  format?: string;
}

export interface EnumColumnConfig extends ColumnConfigBase {
  type: 'enum';
  /** Name of the enum to resolve the value against — required, and now actually required. */
  enum: string;
}

export interface BooleanColumnConfig extends ColumnConfigBase {
  type: 'boolean';
  iconTrue?: string;
  iconFalse?: string;
  hideTrueIcon?: boolean;
  hideFalseIcon?: boolean;
}

export interface IconColumnConfig extends ColumnConfigBase {
  type: 'icon';
  /** Static icon name; omit to use the cell value as the name. */
  icon?: string;
  /** Only render when the value is truthy. Default `true`. */
  showWhenTruthy?: boolean;
}

/** A column whose `type` is one the consumer registered. Extra keys are its own business. */
export interface CustomColumnConfig extends ColumnConfigBase {
  type: string;
  [key: string]: unknown;
}

export type BuiltInColumnConfig =
  | StringColumnConfig
  | NumberColumnConfig
  | TimestampColumnConfig
  | EnumColumnConfig
  | BooleanColumnConfig
  | IconColumnConfig;

export type ColumnConfig = BuiltInColumnConfig | CustomColumnConfig;

/** The built-in type names, in one place so the registry and the validator agree. */
export const BUILT_IN_TYPES: readonly string[] = [
  'string',
  'text',
  'number',
  'integer',
  'timestamp',
  'enum',
  'boolean',
  'icon',
];

const ALIGN: Record<string, 'start' | 'center' | 'end'> = {
  start: 'start',
  left: 'start',
  center: 'center',
  end: 'end',
  right: 'end',
};

function availabilityOf(config: ColumnConfig): ColumnAvailability {
  if (config.hidden === true) return 'absent';
  return config.hideInMenu === true ? 'pinned' : 'toggleable';
}

/** Everything not consumed by the base shape, handed to the cell as `column.options`. */
const BASE_KEYS: readonly string[] = [
  'name',
  'title',
  'translate',
  'visible',
  'hideInMenu',
  'hidden',
  'width',
  'align',
  'sortdisabled',
  'searchDisabled',
  'resizable',
  'tooltip',
  'type',
];

function optionsOf(config: ColumnConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!BASE_KEYS.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * Check a whole config at once and throw ONE error listing every problem.
 *
 * `knownTypes` is the built-ins plus whatever the consumer registered, so an unknown `type` is caught
 * here rather than becoming an empty column at render time.
 */
export function validateColumns(configs: readonly ColumnConfig[], knownTypes: readonly string[]): void {
  const problems: string[] = [];
  const seen: Set<string> = new Set<string>();

  configs.forEach((config, index) => {
    const at: string = `columns[${index}]${config?.name ? ` (${config.name})` : ''}`;
    if (!config || typeof config !== 'object') {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!config.name) problems.push(`${at}: missing "name"`);
    else if (seen.has(config.name)) problems.push(`${at}: duplicate name "${config.name}"`);
    else seen.add(config.name);

    if (!config.type) problems.push(`${at}: missing "type"`);
    else if (!knownTypes.includes(config.type)) {
      problems.push(`${at}: unknown type "${config.type}" — register a cell for it, or use one of: ${knownTypes.join(', ')}`);
    }

    if (config.type === 'enum' && !(config as EnumColumnConfig).enum) {
      problems.push(`${at}: type "enum" requires an "enum" name`);
    }
    if (config.align !== undefined && !(config.align in ALIGN)) {
      problems.push(`${at}: align "${String(config.align)}" is not one of start, center, end, left, right`);
    }
  });

  if (problems.length > 0) {
    throw new Error(`@weave-framework/extra table: invalid column configuration\n  - ${problems.join('\n  - ')}`);
  }
}

/** Turn validated config into the resolved form the renderers read. `absent` columns are dropped. */
export function resolveColumns(
  configs: readonly ColumnConfig[],
  translate: (key: string, params?: Record<string, unknown>) => string
): ResolvedColumn[] {
  const out: ResolvedColumn[] = [];
  for (const config of configs) {
    const availability: ColumnAvailability = availabilityOf(config);
    if (availability === 'absent') continue;
    out.push({
      name: config.name,
      type: config.type,
      title: config.translate && config.title ? translate(config.title) : (config.title ?? config.name),
      availability,
      visible: config.visible !== false,
      width: config.width,
      align: config.align ? ALIGN[config.align] : undefined,
      sortable: config.sortdisabled !== true,
      filterable: config.searchDisabled !== true,
      options: Object.freeze(optionsOf(config)),
    });
  }
  return out;
}
