/**
 * Référentiel sectoriel mobile (V1.3) — miroir du backend
 * (company.entity.ts, enum Industry) : 15 secteurs avec identité visuelle.
 * Chaque secteur fournit une palette de thème et un pictogramme texte
 * (glyphe unicode, volontairement sans emoji pour rester professionnel).
 */

export interface IndustryMeta {
  code: string;
  label: string;
  group: string;
  glyph: string;
  description: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
  };
}

export const INDUSTRIES: IndustryMeta[] = [
  {
    code: 'SupplyChain',
    label: 'Supply Chain',
    group: 'Logistique',
    glyph: '\u21C4',
    description: 'Traitement, logistique et chaîne d’approvisionnement',
    palette: { primary: '#38bdf8', secondary: '#0ea5e9', accent: '#f59e0b', background: '#0b1220', surface: '#1e293b', text: '#e2e8f0', muted: '#94a3b8' },
  },
  {
    code: 'RealEstate',
    label: 'Immobilier',
    group: 'Services',
    glyph: '\u2302',
    description: 'Promotion, gestion et transaction immobilière',
    palette: { primary: '#f97316', secondary: '#ea580c', accent: '#fde047', background: '#160f0b', surface: '#2b211b', text: '#f5ede6', muted: '#b8a89c' },
  },
  {
    code: 'Energy',
    label: 'Énergie',
    group: 'Énergie',
    glyph: '\u26A1',
    description: 'Production, distribution et négoce d’énergie',
    palette: { primary: '#fbbf24', secondary: '#f59e0b', accent: '#34d399', background: '#141006', surface: '#2a2410', text: '#f7efd9', muted: '#b8ac84' },
  },
  {
    code: 'Banking',
    label: 'Banque & Finance',
    group: 'Services',
    glyph: '\u00A4',
    description: 'Services bancaires et financiers',
    palette: { primary: '#34d399', secondary: '#10b981', accent: '#f87171', background: '#04140d', surface: '#123026', text: '#dff7ec', muted: '#8fb8a8' },
  },
  {
    code: 'Metallurgy',
    label: 'Métallurgie',
    group: 'Industriel',
    glyph: '\u25C6',
    description: 'Métallurgie et transformation des métaux',
    palette: { primary: '#94a3b8', secondary: '#64748b', accent: '#fb923c', background: '#101319', surface: '#23272f', text: '#e3e7ec', muted: '#9aa2ad' },
  },
  {
    code: 'Healthcare',
    label: 'Santé',
    group: 'Services',
    glyph: '\u271E',
    description: 'Établissements et services de santé',
    palette: { primary: '#f472b6', secondary: '#ec4899', accent: '#60a5fa', background: '#160b12', surface: '#2b1b24', text: '#f8e7f0', muted: '#b99aab' },
  },
  {
    code: 'Fashion',
    label: 'Mode',
    group: 'Industriel',
    glyph: '\u2726',
    description: 'Création et distribution de mode',
    palette: { primary: '#c084fc', secondary: '#a855f7', accent: '#fcd34d', background: '#120c1a', surface: '#261b33', text: '#f0e8fa', muted: '#b0a2c2' },
  },
  {
    code: 'IndustrialTextile',
    label: 'Textile industriel',
    group: 'Industriel',
    glyph: '\u2740',
    description: 'Textile technique et industrialisation',
    palette: { primary: '#2dd4bf', secondary: '#14b8a6', accent: '#f59e0b', background: '#071412', surface: '#122723', text: '#d9f5f0', muted: '#8fb3ac' },
  },
  {
    code: 'Defense',
    label: 'Armement & Défense',
    group: 'Industriel',
    glyph: '\u25A0',
    description: 'Équipements et services de défense',
    palette: { primary: '#4ade80', secondary: '#22c55e', accent: '#fbbf24', background: '#07130b', surface: '#122618', text: '#ddf4e4', muted: '#8faf99' },
  },
  {
    code: 'Technology',
    label: 'Technologie',
    group: 'Technologie',
    glyph: '\u25C8',
    description: 'Édition logicielle, IA et infra tech',
    palette: { primary: '#60a5fa', secondary: '#3b82f6', accent: '#22d3ee', background: '#0a1220', surface: '#16233a', text: '#e2ebfa', muted: '#93a5c4' },
  },
  {
    code: 'InternationalTrade',
    label: 'Commerce international',
    group: 'Logistique',
    glyph: '\u2693',
    description: 'Import-export et négoce international',
    palette: { primary: '#22d3ee', secondary: '#06b6d4', accent: '#fbbf24', background: '#06141a', surface: '#0f2831', text: '#d9f2f8', muted: '#8bb0ba' },
  },
  {
    code: 'Aviation',
    label: 'Aviation',
    group: 'Logistique',
    glyph: '\u2708',
    description: 'Transport aérien et maintenance aéronautique',
    palette: { primary: '#7dd3fc', secondary: '#38bdf8', accent: '#f97316', background: '#081220', surface: '#12263c', text: '#e0edfa', muted: '#93a9bf' },
  },
  {
    code: 'Maritime',
    label: 'Maritime & Transport',
    group: 'Logistique',
    glyph: '\u2693',
    description: 'Logistique maritime, portuaire et intermodal',
    palette: { primary: '#38bdf8', secondary: '#0284c7', accent: '#fde047', background: '#061426', surface: '#0e2a45', text: '#d8ecf7', muted: '#8aa8c4' },
  },
  {
    code: 'Spatial',
    label: 'Aérospatial & Spatial',
    group: 'Spatial',
    glyph: '\u2605',
    description: 'Satellite, lanceurs et services spatiaux',
    palette: { primary: '#a78bfa', secondary: '#7c3aed', accent: '#f0abfc', background: '#0e0b1c', surface: '#1f1a36', text: '#eae4fa', muted: '#a49bc4' },
  },
  {
    code: 'Biotech',
    label: 'Biotechnologie & Pharma',
    group: 'Services',
    glyph: '\u2623',
    description: 'Biotech, dispositifs médicaux et pharma',
    palette: { primary: '#4ade80', secondary: '#16a34a', accent: '#ffffff', background: '#07130a', surface: '#10241a', text: '#dcf5e2', muted: '#8fb89c' },
  },
];

export const DEFAULT_PALETTE = INDUSTRIES[0].palette;

export function findIndustry(code: string | null | undefined): IndustryMeta | undefined {
  if (!code) return undefined;
  return INDUSTRIES.find((i) => i.code === code);
}
