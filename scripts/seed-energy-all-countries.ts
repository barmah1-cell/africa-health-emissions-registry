/**
 * Seed energy profiles and emissions for major hospitals across African countries.
 * 
 * Based on research:
 * - Large hospitals: 60-92 kWh/bed/day → ~22,000-33,000 kWh/bed/year
 * - Medium hospitals: 43-60 kWh/bed/day → ~15,700-22,000 kWh/bed/year
 * - Small clinics: 25 kWh/day total (~9,100 kWh/year)
 * - Many facilities rely on diesel generators (26% have no grid access in sub-Saharan Africa)
 * - Solar installations are growing, especially in East Africa
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Energy profiles based on facility size and country context
interface EnergyAssignment {
  country: string;
  nameContains: string;
  sources: Array<{ type: string; consumptionKwhYear: number }>;
}

const ENERGY_ASSIGNMENTS: EnergyAssignment[] = [
  // === SOUTH AFRICA (high grid reliance, coal-heavy grid) ===
  { country: 'South Africa', nameContains: 'Chris Hani Baragwanath', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 85000000 }, // 3200 beds × 73 kWh/bed/day
    { type: 'diesel_generator', consumptionKwhYear: 5000000 },
  ]},
  { country: 'South Africa', nameContains: 'Groote Schuur', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 25000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3000000 },
    { type: 'solar', consumptionKwhYear: 800000 },
  ]},
  { country: 'South Africa', nameContains: 'Tygerberg', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 35000000 },
    { type: 'diesel_generator', consumptionKwhYear: 4000000 },
  ]},
  { country: 'South Africa', nameContains: 'Steve Biko', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 22000000 },
    { type: 'diesel_generator', consumptionKwhYear: 2500000 },
    { type: 'solar', consumptionKwhYear: 500000 },
  ]},
  { country: 'South Africa', nameContains: 'Inkosi Albert', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 24000000 },
    { type: 'diesel_generator', consumptionKwhYear: 2000000 },
  ]},
  { country: 'South Africa', nameContains: 'Charlotte Maxeke', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 30000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3500000 },
  ]},

  // === NIGERIA (heavy diesel reliance due to unreliable grid) ===
  { country: 'Nigeria', nameContains: 'Lagos University Teaching', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 8000000 },
    { type: 'diesel_generator', consumptionKwhYear: 12000000 },
  ]},
  { country: 'Nigeria', nameContains: 'National Hospital Abuja', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 6000000 },
    { type: 'diesel_generator', consumptionKwhYear: 9000000 },
    { type: 'solar', consumptionKwhYear: 400000 },
  ]},
  { country: 'Nigeria', nameContains: 'University College Hospital Ibadan', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 7000000 },
    { type: 'diesel_generator', consumptionKwhYear: 11000000 },
  ]},
  { country: 'Nigeria', nameContains: 'Ahmadu Bello', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 5000000 },
    { type: 'diesel_generator', consumptionKwhYear: 8000000 },
  ]},
  { country: 'Nigeria', nameContains: 'Lagos State University Teaching', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 5500000 },
    { type: 'diesel_generator', consumptionKwhYear: 7500000 },
  ]},
  { country: 'Nigeria', nameContains: 'Jos University', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 4500000 },
    { type: 'diesel_generator', consumptionKwhYear: 7000000 },
    { type: 'solar', consumptionKwhYear: 200000 },
  ]},

  // === GHANA (mixed grid and diesel) ===
  { country: 'Ghana', nameContains: 'Korle Bu', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 30000000 },
    { type: 'diesel_generator', consumptionKwhYear: 5000000 },
  ]},
  { country: 'Ghana', nameContains: 'Komfo Anokye', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 18000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3000000 },
    { type: 'solar', consumptionKwhYear: 600000 },
  ]},
  { country: 'Ghana', nameContains: 'Cape Coast Teaching', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 8000000 },
    { type: 'diesel_generator', consumptionKwhYear: 1500000 },
  ]},
  { country: 'Ghana', nameContains: 'Tamale Teaching', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 7500000 },
    { type: 'diesel_generator', consumptionKwhYear: 2000000 },
    { type: 'solar', consumptionKwhYear: 300000 },
  ]},
  { country: 'Ghana', nameContains: 'Trust Hospital', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 3000000 },
    { type: 'solar', consumptionKwhYear: 500000 },
  ]},

  // === RWANDA (clean grid - hydro heavy) ===
  { country: 'Rwanda', nameContains: 'King Faisal', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 5000000 },
    { type: 'solar', consumptionKwhYear: 800000 },
  ]},
  { country: 'Rwanda', nameContains: 'Centre Hospitalier Universitaire', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 9000000 },
    { type: 'diesel_generator', consumptionKwhYear: 1500000 },
    { type: 'solar', consumptionKwhYear: 400000 },
  ]},
  { country: 'Rwanda', nameContains: 'Butaro', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 2500000 },
    { type: 'solar', consumptionKwhYear: 1200000 },
  ]},

  // === TANZANIA ===
  { country: 'Tanzania', nameContains: 'Muhimbili', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 20000000 },
    { type: 'diesel_generator', consumptionKwhYear: 4000000 },
  ]},

  // === UGANDA (very clean grid - hydro) ===
  { country: 'Uganda', nameContains: 'Mulago', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 18000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3000000 },
    { type: 'solar', consumptionKwhYear: 500000 },
  ]},

  // === ETHIOPIA (very clean grid - hydro) ===
  { country: 'Ethiopia', nameContains: 'Black Lion', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 10000000 },
    { type: 'diesel_generator', consumptionKwhYear: 2000000 },
  ]},

  // === ZAMBIA ===
  { country: 'Zambia', nameContains: 'University Teaching Hospital', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 22000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3000000 },
  ]},

  // === MALAWI ===
  { country: 'Malawi', nameContains: 'Queen Elizabeth', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 12000000 },
    { type: 'diesel_generator', consumptionKwhYear: 4000000 },
    { type: 'solar', consumptionKwhYear: 300000 },
  ]},
  { country: 'Malawi', nameContains: 'Kamuzu Central', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 8000000 },
    { type: 'diesel_generator', consumptionKwhYear: 3000000 },
  ]},

  // === ZIMBABWE ===
  { country: 'Zimbabwe', nameContains: 'Parirenyatwa', sources: [
    { type: 'grid_electricity', consumptionKwhYear: 15000000 },
    { type: 'diesel_generator', consumptionKwhYear: 5000000 },
  ]},
];

async function main() {
  try {
    console.log('Assigning energy profiles to facilities across Africa...\n');

    let profilesAssigned = 0;
    let emissionsRecorded = 0;

    for (const assignment of ENERGY_ASSIGNMENTS) {
      const facility = await prisma.facility.findFirst({
        where: {
          nameText: { contains: assignment.nameContains },
          country: assignment.country,
          deletedAt: null,
        },
      });

      if (!facility) {
        console.log(`  ⚠ Not found: "${assignment.nameContains}" in ${assignment.country}`);
        continue;
      }

      // Delete existing energy sources
      await prisma.energySource.deleteMany({ where: { facilityId: facility.id } });

      // Create new sources
      for (const source of assignment.sources) {
        await prisma.energySource.create({
          data: {
            facilityId: facility.id,
            energyType: source.type,
            consumptionKwhYear: source.consumptionKwhYear,
          },
        });
      }

      // Update verification
      await prisma.facility.update({
        where: { id: facility.id },
        data: {
          energyVerificationStatus: 'self_reported',
          energyVerificationDate: new Date(),
        },
      });

      profilesAssigned++;

      // Record GHG emissions based on energy data
      const gridKwh = assignment.sources
        .filter(s => s.type === 'grid_electricity')
        .reduce((sum, s) => sum + s.consumptionKwhYear, 0);
      const dieselKwh = assignment.sources
        .filter(s => s.type === 'diesel_generator')
        .reduce((sum, s) => sum + s.consumptionKwhYear, 0);

      // Get emission factors for this country
      const gridFactor = await prisma.emissionFactor.findFirst({
        where: { country: assignment.country, energySourceType: 'grid_electricity' },
        orderBy: { referenceYear: 'desc' },
      });
      const dieselFactor = await prisma.emissionFactor.findFirst({
        where: { country: assignment.country, energySourceType: 'diesel_generator' },
        orderBy: { referenceYear: 'desc' },
      });

      // Scope 2: Grid emissions
      if (gridKwh > 0 && gridFactor) {
        const tonnes = (gridKwh * Number(gridFactor.factorKgCo2ePerKwh)) / 1000;
        try {
          await prisma.ghgEmission.create({
            data: {
              facilityId: facility.id,
              emissionScope: 'scope_2',
              valueTonnesCo2e: Math.round(tonnes * 100) / 100,
              reportingYear: 2023,
            },
          });
          emissionsRecorded++;
        } catch (e: any) { if (e.code !== 'P2002') throw e; }
      }

      // Scope 1: Diesel emissions
      if (dieselKwh > 0 && dieselFactor) {
        const tonnes = (dieselKwh * Number(dieselFactor.factorKgCo2ePerKwh)) / 1000;
        try {
          await prisma.ghgEmission.create({
            data: {
              facilityId: facility.id,
              emissionScope: 'scope_1',
              valueTonnesCo2e: Math.round(tonnes * 100) / 100,
              reportingYear: 2023,
            },
          });
          emissionsRecorded++;
        } catch (e: any) { if (e.code !== 'P2002') throw e; }
      }

      console.log(`  ✓ ${facility.nameText} (${assignment.country})`);
    }

    console.log(`\n=== COMPLETE ===`);
    console.log(`Energy profiles assigned: ${profilesAssigned}`);
    console.log(`Emission records created: ${emissionsRecorded}`);

    // Summary
    const totalEnergy = await prisma.energySource.count();
    const totalEmissions = await prisma.ghgEmission.count();
    console.log(`\nTotal energy sources in DB: ${totalEnergy}`);
    console.log(`Total emission records in DB: ${totalEmissions}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
