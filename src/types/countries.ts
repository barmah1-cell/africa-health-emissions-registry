/**
 * List of 54 recognized African nations.
 * Used for validating country fields in facility records and emission factors.
 */

export const AFRICAN_COUNTRIES = [
  'Algeria',
  'Angola',
  'Benin',
  'Botswana',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cameroon',
  'Central African Republic',
  'Chad',
  'Comoros',
  'Congo',
  'Côte d\'Ivoire',
  'Democratic Republic of the Congo',
  'Djibouti',
  'Egypt',
  'Equatorial Guinea',
  'Eritrea',
  'Eswatini',
  'Ethiopia',
  'Gabon',
  'Gambia',
  'Ghana',
  'Guinea',
  'Guinea-Bissau',
  'Kenya',
  'Lesotho',
  'Liberia',
  'Libya',
  'Madagascar',
  'Malawi',
  'Mali',
  'Mauritania',
  'Mauritius',
  'Morocco',
  'Mozambique',
  'Namibia',
  'Niger',
  'Nigeria',
  'Rwanda',
  'São Tomé and Príncipe',
  'Senegal',
  'Seychelles',
  'Sierra Leone',
  'Somalia',
  'South Africa',
  'South Sudan',
  'Sudan',
  'Tanzania',
  'Togo',
  'Tunisia',
  'Uganda',
  'Zambia',
  'Zimbabwe',
] as const;

/** Type representing a valid African country name */
export type AfricanCountry = typeof AFRICAN_COUNTRIES[number];

/** Set for O(1) lookup of valid African countries */
export const AFRICAN_COUNTRIES_SET: ReadonlySet<string> = new Set(AFRICAN_COUNTRIES);

/**
 * Check if a given string is a recognized African country.
 */
export function isValidAfricanCountry(country: string): country is AfricanCountry {
  return AFRICAN_COUNTRIES_SET.has(country);
}
