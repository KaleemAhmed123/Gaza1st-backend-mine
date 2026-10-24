import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultSubjects = [
  { groupKey: 'subject', value: 'engineering', labelEn: 'Engineering', sortOrder: 10 },
  { groupKey: 'subject', value: 'medicine', labelEn: 'Medicine', sortOrder: 20 },
  { groupKey: 'subject', value: 'computer_science', labelEn: 'Computer Science', sortOrder: 30 },
  { groupKey: 'subject', value: 'physics', labelEn: 'Physics', sortOrder: 40 },
  { groupKey: 'subject', value: 'business', labelEn: 'Business', sortOrder: 50 },
  { groupKey: 'subject', value: 'humanities', labelEn: 'Humanities', sortOrder: 60 },
  { groupKey: 'subject', value: 'social_sciences', labelEn: 'Social Sciences', sortOrder: 70 },
  { groupKey: 'subject', value: 'arts', labelEn: 'Arts', sortOrder: 80 },
  { groupKey: 'subject', value: 'law', labelEn: 'Law', sortOrder: 90 },
  { groupKey: 'subject', value: 'dentistry', labelEn: 'Dentistry', sortOrder: 100 },
  { groupKey: 'subject', value: 'pharmacy', labelEn: 'Pharmacy', sortOrder: 110 },
  { groupKey: 'subject', value: 'pure_sciences', labelEn: 'Pure Sciences', sortOrder: 120 },
  { groupKey: 'subject', value: 'other', labelEn: 'Other', sortOrder: 130 },
];

const defaultDegrees = [
  { groupKey: 'degree', value: 'undergraduate', labelEn: 'Undergraduate', sortOrder: 10 },
  { groupKey: 'degree', value: 'masters', labelEn: "Master's", sortOrder: 20 },
  { groupKey: 'degree', value: 'phd', labelEn: 'PhD', sortOrder: 30 },
  { groupKey: 'degree', value: 'research', labelEn: 'Research', sortOrder: 40 },
  { groupKey: 'degree', value: 'foundation', labelEn: 'Foundation / pathway', sortOrder: 50 },
  { groupKey: 'degree', value: 'residential_independent_school', labelEn: 'Residential Independent School', sortOrder: 60 },
];

async function main() {
  console.log('Seeding default subjects and degrees...');
  const all = [...defaultSubjects, ...defaultDegrees];
  for (const item of all) {
    await prisma.configOption.upsert({
      where: {
        groupKey_value: {
          groupKey: item.groupKey,
          value: item.value,
        },
      },
      update: {
        labelEn: item.labelEn,
        sortOrder: item.sortOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        groupKey: item.groupKey,
        value: item.value,
        labelEn: item.labelEn,
        sortOrder: item.sortOrder,
        isActive: true,
        deletedAt: null,
      },
    });
    console.log(`Upserted ${item.groupKey}: ${item.value} (${item.labelEn})`);
  }
  console.log('Finished seeding subjects and degrees successfully.');
}

main()
  .catch((e) => {
    console.error('Failed to seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
