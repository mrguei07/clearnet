/**
 * Référentiel sectoriel ClearNet (extension V1.1).
 * Les 12 valeurs héritées sont strictement préservées pour la rétrocompatibilité.
 * Les 3 verticales nouvelles (Maritime, Spatial, Biotech) sont ajoutées à la fin.
 */
export enum Industry {
  SUPPLY_CHAIN = 'SupplyChain',
  REAL_ESTATE = 'RealEstate',
  ENERGY = 'Energy',
  BANKING = 'Banking',
  METALLURGY = 'Metallurgy',
  HEALTHCARE = 'Healthcare',
  FASHION = 'Fashion',
  INDUSTRIAL_TEXTILE = 'IndustrialTextile',
  DEFENSE = 'Defense',
  TECHNOLOGY = 'Technology',
  INTERNATIONAL_TRADE = 'InternationalTrade',
  AVIATION = 'Aviation',
  MARITIME = 'Maritime',
  SPATIAL = 'Spatial',
  BIOTECH = 'Biotech',
}

export const LEGACY_INDUSTRIES: readonly Industry[] = [
  Industry.SUPPLY_CHAIN,
  Industry.REAL_ESTATE,
  Industry.ENERGY,
  Industry.BANKING,
  Industry.METALLURGY,
  Industry.HEALTHCARE,
  Industry.FASHION,
  Industry.INDUSTRIAL_TEXTILE,
  Industry.DEFENSE,
  Industry.TECHNOLOGY,
  Industry.INTERNATIONAL_TRADE,
  Industry.AVIATION,
] as const;

export const EXTENSION_INDUSTRIES: readonly Industry[] = [
  Industry.MARITIME,
  Industry.SPATIAL,
  Industry.BIOTECH,
] as const;

export const ALL_INDUSTRIES: readonly Industry[] = [
  ...LEGACY_INDUSTRIES,
  ...EXTENSION_INDUSTRIES,
] as const;

export function isIndustry(value: unknown): value is Industry {
  return typeof value === 'string' && ALL_INDUSTRIES.includes(value as Industry);
}

export interface CompanyRecord {
  id: string;
  name: string;
  industry: Industry | null;
  country: string | null;
  address: string | null;
  createdAt?: string;
}

export interface IndustryDetails {
  industry: Industry;
  label: string;
  group: 'logistique' | 'services' | 'industriel' | 'energie' | 'technologie' | 'spatial';
  version: 'v1' | 'v1.1';
  description: string;
}

const INDUSTRY_DETAILS: readonly [(typeof Industry)[keyof typeof Industry], IndustryDetails][] = [
  [Industry.SUPPLY_CHAIN, { industry: Industry.SUPPLY_CHAIN, label: 'Supply Chain', group: 'logistique', version: 'v1', description: 'Traitement, logistique et chaîne d’approvisionnement' }],
  [Industry.REAL_ESTATE, { industry: Industry.REAL_ESTATE, label: 'Immobilier', group: 'services', version: 'v1', description: 'Promotion, gestion et transaction immobilière' }],
  [Industry.ENERGY, { industry: Industry.ENERGY, label: 'Énergie', group: 'energie', version: 'v1', description: 'Production, distribution et négoce d’énergie' }],
  [Industry.BANKING, { industry: Industry.BANKING, label: 'Banque & Finance', group: 'services', version: 'v1', description: 'Services bancaires et financiers' }],
  [Industry.METALLURGY, { industry: Industry.METALLURGY, label: 'Métallurgie', group: 'industriel', version: 'v1', description: 'Métallurgie et transformation des métaux' }],
  [Industry.HEALTHCARE, { industry: Industry.HEALTHCARE, label: 'Santé', group: 'services', version: 'v1', description: 'Établissements et services de santé' }],
  [Industry.FASHION, { industry: Industry.FASHION, label: 'Mode', group: 'industriel', version: 'v1', description: 'Création et distribution de mode' }],
  [Industry.INDUSTRIAL_TEXTILE, { industry: Industry.INDUSTRIAL_TEXTILE, label: 'Textile industriel', group: 'industriel', version: 'v1', description: 'Textile technique et industrialisation' }],
  [Industry.DEFENSE, { industry: Industry.DEFENSE, label: 'Armement & Défense', group: 'industriel', version: 'v1', description: 'Équipements et services de défense' }],
  [Industry.TECHNOLOGY, { industry: Industry.TECHNOLOGY, label: 'Technologie', group: 'technologie', version: 'v1', description: 'Édition logicielle, IA et infra tech' }],
  [Industry.INTERNATIONAL_TRADE, { industry: Industry.INTERNATIONAL_TRADE, label: 'Commerce international', group: 'logistique', version: 'v1', description: 'Import-export et négoce international' }],
  [Industry.AVIATION, { industry: Industry.AVIATION, label: 'Aviation', group: 'logistique', version: 'v1', description: 'Transport aérien et la/maintenance aéronautique' }],
  [Industry.MARITIME, { industry: Industry.MARITIME, label: 'Maritime & Transport', group: 'logistique', version: 'v1.1', description: 'Logistique maritime, portuaire et transport intermodal' }],
  [Industry.SPATIAL, { industry: Industry.SPATIAL, label: 'Aérospatial & Spatial', group: 'spatial', version: 'v1.1', description: 'Satellite, lanceurs et services spatiaux' }],
  [Industry.BIOTECH, { industry: Industry.BIOTECH, label: 'Biotechnologie & Pharma', group: 'services', version: 'v1.1', description: 'Biotech, dispositifs médicaux et industrie pharmaceutique' }],
];

export function getIndustries(): IndustryDetails[] {
  return INDUSTRY_DETAILS.map(([, details]) => details);
}

export function findIndustryDetails(industry: Industry): IndustryDetails | undefined {
  const entry = INDUSTRY_DETAILS.find(([code]) => code === industry);
  return entry ? entry[1] : undefined;
}