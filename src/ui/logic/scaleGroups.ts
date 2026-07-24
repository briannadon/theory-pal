// Groups theory/'s flat 21-scale table into the three families the key/scale
// picker calls for (PLAN.md "Architecture 5. ui/"): the 7 diatonic modes,
// the harmonic-minor family, and the melodic-minor family.
import { allScales, type Scale, type ScaleId } from '../../theory/index.ts';

export interface ScaleGroup {
  label: string;
  scales: Scale[];
}

const GROUP_SIZE = 7;

/**
 * `theory/scales.ts`'s `SCALE_TABLE` is laid out, by its own comments, in
 * exactly this order: 7 diatonic modes, then harmonic minor + its 7 modes,
 * then melodic minor + its 7 modes. Grouping by that documented order (three
 * even slices of 7) avoids re-deriving family membership from interval math
 * here, which would be theory logic leaking into the UI layer.
 */
export function scaleGroups(): ScaleGroup[] {
  const scales = allScales();
  return [
    { label: 'Diatonic Modes', scales: scales.slice(0, GROUP_SIZE) },
    { label: 'Harmonic Minor Family', scales: scales.slice(GROUP_SIZE, GROUP_SIZE * 2) },
    { label: 'Melodic Minor Family', scales: scales.slice(GROUP_SIZE * 2, GROUP_SIZE * 3) },
  ];
}

export function findScaleGroupLabel(id: ScaleId): string {
  return scaleGroups().find((g) => g.scales.some((s) => s.id === id))?.label ?? '';
}
