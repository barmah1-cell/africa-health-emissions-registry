/**
 * Seed energy profiles, emission factors, and sample GHG emissions data.
 * 
 * 1. Loads country-specific emission factors for major African countries
 * 2. Assigns energy profiles to Kenyan hospitals (sample set)
 * 3. Records sample GHG emissions for some facilities
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Country emission factors (kg CO2e per kWh) - based on real grid emission factors
const EMISSION_FACTORS = [
  { country: 'Kenya', energySourceType: 'grid_electricity', factor: 0.332, year: 2022 },
  { country: 'Kenya', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Kenya', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'Nigeria', energySourceType: 'grid_electricity', factor: 0.43, year: 2022 },
  { country: 'Nigeria', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Nigeria', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'South Africa', energySourceType: 'grid_electricity', factor: 0.928, year: 2022 },
  { country: 'South Africa', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'Ghana', energySourceType: 'grid_electricity', factor: 0.364, year: 2022 },
  { country: 'Ghana', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Ghana', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'Rwanda', energySourceType: 'grid_electricity', factor: 0.237, year: 2022 },
  { country: 'Rwanda', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'Tanzania', energySourceType: 'grid_electricity', factor: 0.295, year: 2022 },
  { country: 'Tanzania', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Uganda', energySourceType: 'grid_electricity', factor: 0.117, year: 2022 },
  { country: 'Uganda', energySourceType: 'solar', factor: 0.041, year: 2022 },
  { country: 'Ethiopia', energySourceType: 'grid_electricity', factor: 0.04, year: 2022 },
  { country: 'Ethiopia', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Democratic Republic of the Congo', energySourceType: 'grid_electricity', factor: 0.003, year: 2022 },
  { country: 'Democratic Republic of the Congo', energySourceType: 'diesel_generator', factor: 0.8, year: 2022 },
  { country: 'Cameroon', energySourceType: 'grid_electricity', factor: 0.268, year: 2022 },
  { country: 'Mozambique', energySourceType: 'grid_electricity', factor: 0.094, year: 2022 },
  { country: 'Zambia', energySourceType: 'grid_electricity', factor: 0.023, year: 2022 },
  { country: 'Zimbabwe', energySourceType: 'grid_electricity', factor: 0.629, year: 2022 },
  { country: 'Malawi', energySourceType: 'grid_electricity', factor: 0.075, year: 2022 },
  // Older year factors for temporal lookup testing
  { country: 'Kenya', energySourceType: 'grid_electricity', factor: 0.355, year: 2020 },
  { country: 'Kenya', energySourceType: 'grid_electricity', factor: 0.380, year: 2018 },
  { country: 'South Africa', energySourceType: 'grid_electricity', factor: 0.954, year: 2020 },
  { country: 'Nigeria', energySourceType: 'grid_electricity', factor: 0.45, year: 2020 },
];

// Sample energy profiles for Kenyan hospitals
const ENERGY_PROFILES: Array<{
  namePattern: string;
  sources: Array<{ type: string; consumption?: number }>;
}> = [
  { namePattern: 'Kenyatta National Hospital', sources: [
    { type: 'grid_electricity', consumption: 12000000 },
    { type: 'diesel_generator', consumption: 3000000 },
    { type: 'solar', consumption: 500000 }
  ]},
  { namePattern: 'Moi Teaching', sources: [
    { type: 'grid_electricity', consumption: 8000000 },
    { type: 'diesel_generator', consumption: 2000000 },
    { type: 'solar', consumption: 300000 }
  ]},
  { namePattern: 'Aga Khan University', sources: [
    { type: 'grid_electricity', consumption: 5000000 },
    { type: 'solar', consumption: 800000 }
  ]},
  { namePattern: 'Nairobi Hospital', sources: [
    { type: 'grid_electricity', consumption: 4500000 },
    { type: 'diesel_generator', consumption: 1000000 }
  ]},
  { namePattern: 'Coast General', sources: [
    { type: 'grid_electricity', consumption: 3500000 },
    { type: 'diesel_generator', consumption: 1500000 }
  ]},
  { namePattern: 'Nakuru Level 5', sources: [
    { type: 'grid_electricity', consumption: 2500000 },
    { type: 'diesel_generator', consumption: 800000 }
  ]},
  { namePattern: 'Machakos Level 5', sources: [
    { type: 'grid_electricity', consumption: 2000000 },
    { type: 'diesel_generator', consumption: 600000 }
  ]},
  { namePattern: 'Kisumu County Hospital', sources: [
    { type: 'grid_electricity', consumption: 2200000 },
    { type: 'diesel_generator', consumption: 700000 },
    { type: 'solar', consumption: 150000 }
  ]},
  { namePattern: 'Karen Hospital', sources: [
    { type: 'grid_electricity', consumption: 3000000 },
    { type: 'solar', consumption: 1200000 }
  ]},
  { namePattern: 'Gertrude', sources: [
    { type: 'grid_electricity', consumption: 2000000 },
    { type: 'solar', consumption: 400000 }
  ]},
];

async function main() {
  try {
    // 1. Load emission factors
    console.log('Loading emission factors...');
    let factorsLoaded = 0;
    for (const ef of EMISSION_FACTORS) {
      try {
        await prisma.emissionFactor.create({
          data: {
            country: ef.country,
            energySourceType: ef.energySourceType,
            factorKgCo2ePerKwh: ef.factor,
            referenceYear: ef.year,
          },
        });
        factorsLoaded++;
      } catch (e: any) {
        if (e.code === 'P2002') continue; // skip duplicates
        throw e;
      }
    }
    console.log(`  Loaded ${factorsLoaded} emission factors\n`);

    // 2. Assign energy profiles to Kenyan hospitals
    console.log('Assigning energy profiles...');
    let profilesAssigned = 0;

    for (const profile of ENERGY_PROFILES) {
      const facility = await prisma.facility.findFirst({
        where: {
          nameText: { contains: profile.namePattern },
          country: 'Kenya',
          deletedAt: null,
        },
      });

      if (!facility) {
        console.log(`  Warning: Could not find facility matching "${profile.namePattern}"`);
        continue;
      }

      // Delete existing energy sources
      await prisma.energySource.deleteMany({ where: { facilityId: facility.id } });

      // Create new sources
      for (const source of profile.sources) {
        await prisma.energySource.create({
          data: {
            facilityId: facility.id,
            energyType: source.type,
            consumptionKwhYear: source.consumption || null,
          },
        });
      }

      // Update verification date
      await prisma.facility.update({
        where: { id: facility.id },
        data: {
          energyVerificationStatus: 'self_reported',
          energyVerificationDate: new Date(),
        },
      });

      profilesAssigned++;
    }
    console.log(`  Assigned energy profiles to ${profilesAssigned} facilities\n`);

    // 3. Record sample GHG emissions
    console.log('Recording GHG emissions...');
    let emissionsRecorded = 0;

    const facilitiesWithEnergy = await prisma.facility.findMany({
      where: {
        country: 'Kenya',
        deletedAt: null,
        energySources: { some: {} },
      },
      include: { energySources: true },
      take: 10,
    });

    for (const facility of facilitiesWithEnergy) {
      const totalGridKwh = facility.energySources
        .filter(es => es.energyType === 'grid_electricity')
        .reduce((sum, es) => sum + (es.consumptionKwhYear ? Number(es.consumptionKwhYear) : 0), 0);

      const totalDieselKwh = facility.energySources
        .filter(es => es.energyType === 'diesel_generator')
        .reduce((sum, es) => sum + (es.consumptionKwhYear ? Number(es.consumptionKwhYear) : 0), 0);

      // Scope 2: Grid electricity emissions
      if (totalGridKwh > 0) {
        const scope2 = (totalGridKwh * 0.332) / 1000; // tonnes CO2e
        try {
          await prisma.ghgEmission.create({
            data: {
              facilityId: facility.id,
              emissionScope: 'scope_2',
              valueTonnesCo2e: Math.round(scope2 * 100) / 100,
              reportingYear: 2023,
            },
          });
          emissionsRecorded++;
        } catch (e: any) {
          if (e.code !== 'P2002') throw e;
        }
      }

      // Scope 1: Diesel generator emissions
      if (totalDieselKwh > 0) {
        const scope1 = (totalDieselKwh * 0.8) / 1000; // tonnes CO2e
        try {
          await prisma.ghgEmission.create({
            data: {
              facilityId: facility.id,
              emissionScope: 'scope_1',
              valueTonnesCo2e: Math.round(scope1 * 100) / 100,
              reportingYear: 2023,
            },
          });
          emissionsRecorded++;
        } catch (e: any) {
          if (e.code !== 'P2002') throw e;
        }
      }
    }
    console.log(`  Recorded ${emissionsRecorded} emission entries\n`);

    // Summary
    console.log('=== SEED COMPLETE ===');
    const efCount = await prisma.emissionFactor.count();
    const esCount = await prisma.energySource.count();
    const ghgCount = await prisma.ghgEmission.count();
    console.log(`Emission factors in DB: ${efCount}`);
    console.log(`Energy source entries:  ${esCount}`);
    console.log(`GHG emission records:   ${ghgCount}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
