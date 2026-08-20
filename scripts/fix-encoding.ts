/**
 * Fix facility name encoding issues.
 * 
 * The WHO dataset has mojibake (UTF-8 interpreted as CP1252):
 * ├⌐ → é, ├║ → ú, ├┤ → ô, etc.
 * 
 * This script fixes all affected names directly in the database.
 */

import { PrismaClient } from '@prisma/client';

// Mojibake replacement map (broken → correct)
const ENCODING_FIXES: [string, string][] = [
  // Lowercase accented vowels
  ['├⌐', 'é'], ['├¿', 'è'], ['├¬', 'ê'], ['├½', 'ë'],
  ['├í', 'á'], ['├á', 'à'], ['├ó', 'â'], ['├ú', 'ã'], ['├ñ', 'ä'],
  ['├¡', 'í'], ['├¼', 'ì'], ['├«', 'î'], ['├»', 'ï'],
  ['├│', 'ó'], ['├▓', 'ò'], ['├┤', 'ô'], ['├╡', 'õ'], ['├Â', 'ö'],
  ['├║', 'ú'], ['├╣', 'ù'], ['├╗', 'û'], ['├╝', 'ü'],
  // Cedilla and tilde
  ['├º', 'ç'], ['├ç', 'Ç'],
  ['├▒', 'ñ'], ['├æ', 'Ñ'],
  // Uppercase accented
  ['├ë', 'É'], ['├ê', 'Ê'], ['├ï', 'È'],
  ['├ü', 'Á'], ['├Ä', 'Â'], ['├â', 'Ã'],
  ['├ì', 'Í'], ['├Ä', 'Î'],
  ['├ô', 'Ó'], ['├Ö', 'Ô'], ['├ò', 'Õ'],
  ['├Ü', 'Ú'], ['├Ø', 'Û'],
  // Punctuation mojibake
  ['\u0393\u00c7\u00d6', "'"],  // ΓÇÖ → '
  ['\u0393\u00c7\u00f4', '–'],  // ΓÇô → –
  ['\u0393\u00c7\u00f6', '—'],  // ΓÇö → —
  ['\u0393\u00c7\u00a3', '"'],  // ΓÇ£ → "
  ['\u0393\u00c7\u00a5', '"'],  // ΓÇ¥ → "
  ['ΓÇÖ', "'"],
  ['ΓÇô', '–'],
  ['ΓÇö', '—'],
  ['ΓÇ£', '"'],
  ['ΓÇ¥', '"'],
  ['ΓÇ¿', '…'],
];

function fixEncoding(text: string): string {
  let result = text;
  for (const [broken, correct] of ENCODING_FIXES) {
    result = result.split(broken).join(correct);
  }
  return result;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Fetching facilities with encoding issues...');

    // Find all facilities with names containing mojibake patterns
    const facilities = await prisma.$queryRaw<Array<{
      id: string;
      name_text: string;
      names: any;
    }>>`
      SELECT id, name_text, names
      FROM facility
      WHERE name_text LIKE '%├%' OR name_text LIKE '%ΓÇ%'
    `;

    console.log(`Found ${facilities.length} facilities with encoding issues.\n`);

    if (facilities.length === 0) {
      console.log('No encoding issues found!');
      return;
    }

    let fixed = 0;
    const batchSize = 500;

    for (let i = 0; i < facilities.length; i += batchSize) {
      const batch = facilities.slice(i, i + batchSize);
      
      for (const f of batch) {
        const fixedNameText = fixEncoding(f.name_text);
        const names = f.names as Record<string, string>;
        const fixedNames: Record<string, string> = {};
        
        for (const [locale, name] of Object.entries(names)) {
          fixedNames[locale] = fixEncoding(name);
        }

        if (fixedNameText !== f.name_text || JSON.stringify(fixedNames) !== JSON.stringify(names)) {
          await prisma.$executeRaw`
            UPDATE facility 
            SET name_text = ${fixedNameText},
                names = ${JSON.stringify(fixedNames)}::jsonb
            WHERE id = ${f.id}::uuid
          `;
          fixed++;
        }
      }

      console.log(`Processed ${Math.min(i + batchSize, facilities.length)}/${facilities.length} (${fixed} fixed so far)`);
    }

    console.log(`\n=== ENCODING FIX COMPLETE ===`);
    console.log(`Total fixed: ${fixed}`);

    // Show some samples of fixed names
    const samples = await prisma.$queryRaw<Array<{ name_text: string; country: string }>>`
      SELECT name_text, country FROM facility
      WHERE country IN ('Benin', 'Cameroon', 'Congo')
      ORDER BY name_text
      LIMIT 10
    `;
    console.log('\nSample fixed names:');
    samples.forEach(s => console.log(`  ${s.country}: ${s.name_text}`));

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
