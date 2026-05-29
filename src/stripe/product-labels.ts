/**
 * ONTOGENCE — Product Label Mapping
 *
 * Maps all internal product keys, Stripe price IDs, and legacy metadata strings
 * to clean, human-readable display names.
 *
 * RULE: Internal keys must NEVER be displayed directly to users.
 * Always pass raw strings through formatProductLabel() before rendering.
 */

/** Canonical map: internal key → display label */
export const PRODUCT_LABELS: Record<string, string> = {
  // Canonical product keys (from PRODUCTS constant)
  registration:       'Registration',
  protocol:           'Initial Protocol',
  initialProtocol:    'Initial Protocol',
  protocolRevision:   'Protocol Revision',
  monitoring3Month:   '3-Month Monitoring',
  threeMonthMonitoring: '3-Month Monitoring',
  monitoring6Month:   '6-Month Monitoring',
  sixMonthMonitoring: '6-Month Monitoring',
  vaultAccess:        'Vault Access',
  medicalVaultAccess: 'Vault Access',

  // Legacy / alternate spellings that may appear in older DB records
  'protocol,vaultAccess':          'Initial Protocol, Vault Access',
  'vaultAccess,protocol':          'Vault Access, Initial Protocol',
  'protocol,monitoring3Month':     'Initial Protocol, 3-Month Monitoring',
  'protocol,monitoring6Month':     'Initial Protocol, 6-Month Monitoring',
  'protocolRevision,vaultAccess':  'Protocol Revision, Vault Access',
  payment:            'Payment',
  service:            'Service',
};

/** Stripe price ID → display label */
export const PRICE_ID_LABELS: Record<string, string> = {
  price_1TViA8FJhxAto4oEmDf5PmxS:  'Registration',
  price_1TViBRFJhxAto4oEvYCaUk2o:  'Initial Protocol',
  price_1TViKKFJhxAto4oEaBAF0eqI:  'Protocol Revision',
  price_1TViKnFJhxAto4oE0BtqlA2n:  '3-Month Monitoring',
  price_1TViLaFJhxAto4oEbgjJ5kOy:  '6-Month Monitoring',
  price_1TViNcFJhxAto4oE481iBBtA:  'Vault Access',
};

/**
 * Convert any internal product key, comma-separated key list, or Stripe price ID
 * into a clean, human-readable display string.
 *
 * Examples:
 *   formatProductLabel('vaultAccess')              → 'Vault Access'
 *   formatProductLabel('protocol,vaultAccess')     → 'Initial Protocol, Vault Access'
 *   formatProductLabel('Initial Protocol')         → 'Initial Protocol'  (already clean)
 *   formatProductLabel('price_1TViNcFJhxAto4oE…') → 'Vault Access'
 *   formatProductLabel(null)                       → 'Purchase'
 */
export function formatProductLabel(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return 'Purchase';

  const trimmed = raw.trim();

  // Already a clean label (starts with uppercase, no camelCase)
  // Heuristic: if it contains a space and no lowercase-after-uppercase pattern, it's already human-readable
  if (PRODUCT_LABELS[trimmed]) return PRODUCT_LABELS[trimmed];
  if (PRICE_ID_LABELS[trimmed]) return PRICE_ID_LABELS[trimmed];

  // Comma-separated list of keys — map each token individually
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map(s => s.trim());
    const mapped = parts.map(p => PRODUCT_LABELS[p] || PRICE_ID_LABELS[p] || toTitleCase(p));
    return mapped.join(', ');
  }

  // Single token that isn't in the map — convert camelCase to Title Case as fallback
  return toTitleCase(trimmed);
}

/**
 * Convert a camelCase or PascalCase string to Title Case with spaces.
 * e.g. "protocolRevision" → "Protocol Revision"
 *      "threeMonthMonitoring" → "Three Month Monitoring"
 *      "Initial Protocol" → "Initial Protocol"  (unchanged)
 */
function toTitleCase(str: string): string {
  // If already contains spaces, just capitalize each word
  if (str.includes(' ')) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }
  // Split camelCase / PascalCase on uppercase boundaries
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}
