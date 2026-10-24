import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const regions = [
  { code: "GB", name: "UK" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "EG", name: "Egypt" },
  { code: "US", name: "US" },
  { code: "BA", name: "Bosnia" },
  { code: "TR", name: "Turkey" }
];

const offerFinancialRules = {
  currency: "GBP",
  livingCostRules: {
    UK: {
      london: {
        label: "London",
        amountPerYear: 13761
      },
      outside_london: {
        label: "Outside London",
        amountPerYear: 10539
      }
    }
  },
  durationRule: {
    completeYearsFormula: "floor(durationYears)"
  }
};

const configOptions = [
  { groupKey: "course_field", value: "medicine", labelEn: "Medicine", sortOrder: 10 },
  { groupKey: "course_field", value: "engineering", labelEn: "Engineering", sortOrder: 20 },
  { groupKey: "course_field", value: "pure_sciences", labelEn: "Pure Sciences", sortOrder: 30 },
  { groupKey: "course_field", value: "arts", labelEn: "Arts", sortOrder: 40 },
  { groupKey: "course_level", value: "residential_independent_school", labelEn: "Residential Independent School", sortOrder: 10 },
  { groupKey: "course_level", value: "foundation_bachelor", labelEn: "Foundation + Bachelor", sortOrder: 20 },
  { groupKey: "course_level", value: "bachelor", labelEn: "Bachelor", sortOrder: 30 },
  { groupKey: "course_level", value: "integrated_master", labelEn: "Integrated Master", sortOrder: 40 },
  { groupKey: "course_level", value: "master", labelEn: "Master", sortOrder: 50 },
  { groupKey: "course_level", value: "phd", labelEn: "PhD", sortOrder: 60 },
  // Dynamic Subjects & Degrees
  { groupKey: "subject", value: "engineering", labelEn: "Engineering", sortOrder: 10 },
  { groupKey: "subject", value: "medicine", labelEn: "Medicine", sortOrder: 20 },
  { groupKey: "subject", value: "computer_science", labelEn: "Computer Science", sortOrder: 30 },
  { groupKey: "subject", value: "physics", labelEn: "Physics", sortOrder: 40 },
  { groupKey: "subject", value: "business", labelEn: "Business", sortOrder: 50 },
  { groupKey: "subject", value: "humanities", labelEn: "Humanities", sortOrder: 60 },
  { groupKey: "subject", value: "social_sciences", labelEn: "Social Sciences", sortOrder: 70 },
  { groupKey: "subject", value: "arts", labelEn: "Arts", sortOrder: 80 },
  { groupKey: "subject", value: "law", labelEn: "Law", sortOrder: 90 },
  { groupKey: "subject", value: "dentistry", labelEn: "Dentistry", sortOrder: 100 },
  { groupKey: "subject", value: "pharmacy", labelEn: "Pharmacy", sortOrder: 110 },
  { groupKey: "subject", value: "pure_sciences", labelEn: "Pure Sciences", sortOrder: 120 },
  { groupKey: "subject", value: "other", labelEn: "Other", sortOrder: 130 },
  { groupKey: "degree", value: "undergraduate", labelEn: "Undergraduate", sortOrder: 10 },
  { groupKey: "degree", value: "masters", labelEn: "Master's", sortOrder: 20 },
  { groupKey: "degree", value: "phd", labelEn: "PhD", sortOrder: 30 },
  { groupKey: "degree", value: "research", labelEn: "Research", sortOrder: 40 },
  { groupKey: "degree", value: "foundation", labelEn: "Foundation / pathway", sortOrder: 50 },
  { groupKey: "degree", value: "residential_independent_school", labelEn: "Residential Independent School", sortOrder: 60 },
  { groupKey: "offer_type", value: "conditional", labelEn: "Conditional", sortOrder: 10 },
  { groupKey: "offer_type", value: "unconditional", labelEn: "Unconditional", sortOrder: 20 },
  { groupKey: "offer_type", value: "deferred", labelEn: "Deferred", sortOrder: 30 },
  { groupKey: "offer_type", value: "rejected", labelEn: "Rejected", sortOrder: 40 },
  {
    groupKey: "query_type",
    value: "visa_offer_issue",
    labelEn: "I am facing an issue with my visa/offer.",
    sortOrder: 10,
    metadata: { assignTo: "regional_admin" }
  },
  {
    groupKey: "query_type",
    value: "whatsapp_group_issue",
    labelEn: "I have not been added to the WhatsApp group.",
    sortOrder: 20,
    metadata: { assignTo: "mentor" }
  },
  {
    groupKey: "query_type",
    value: "general_issue",
    labelEn: "General issue",
    sortOrder: 30,
    metadata: { assignTo: "master_admin" }
  },
  { groupKey: "announcement_category", value: "scholarships", labelEn: "Scholarships", sortOrder: 10 },
  { groupKey: "announcement_category", value: "deadlines", labelEn: "Deadlines", sortOrder: 20 },
  { groupKey: "announcement_category", value: "passports", labelEn: "Passports", sortOrder: 30 },
  { groupKey: "announcement_category", value: "webinars", labelEn: "Webinars", sortOrder: 40 },
  { groupKey: "announcement_category", value: "misc", labelEn: "Miscellaneous", sortOrder: 50 }
];

async function seedRegions() {
  await Promise.all(
    regions.map((region) =>
      prisma.region.upsert({
        where: { code: region.code },
        update: { name: region.name, isActive: true, deletedAt: null },
        create: { ...region, deletedAt: null }
      })
    )
  );
}

async function seedOfferFinancialRules() {
  await prisma.appConfig.upsert({
    where: { key: "offer_financial_rules" },
    update: {
      value: offerFinancialRules,
      description: "Configurable financial calculation rules for offer funding checks."
    },
    create: {
      key: "offer_financial_rules",
      value: offerFinancialRules,
      description: "Configurable financial calculation rules for offer funding checks."
    }
  });
}

async function seedConfigOptions() {
  await Promise.all(
    configOptions.map((option) =>
      prisma.configOption.upsert({
        where: {
          groupKey_value: {
            groupKey: option.groupKey,
            value: option.value
          }
        },
        update: {
          labelEn: option.labelEn,
          sortOrder: option.sortOrder,
          isActive: true,
          metadata: "metadata" in option ? option.metadata : undefined,
          deletedAt: null
        },
        create: { ...option, deletedAt: null }
      })
    )
  );
}

async function main() {
  await seedRegions();
  await seedOfferFinancialRules();
  await seedConfigOptions();
  console.log("Seeded offer countries, config options, and offer financial rules.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
