import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { AccountStatus, PrismaClient, RoleCode } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

const regionalAdminEmail = process.env.DEV_REGIONAL_ADMIN_EMAIL || "regional.uk@example.com";
const regionalAdminPassword = process.env.DEV_REGIONAL_ADMIN_PASSWORD || "RegionalPassword123!";
const regionalAdminCountry = (process.env.DEV_REGIONAL_ADMIN_COUNTRY || "UK").trim();
const regionalAdminName = `Development ${regionalAdminCountry} Regional Admin`;

async function main() {
  // Allowed seeding in production by admin request

  const regions = await prisma.region.findMany({
    where: { isActive: true }
  });
  const region = regions.find(
    (candidate) =>
      candidate.name.toLowerCase() === regionalAdminCountry.toLowerCase() ||
      candidate.code.toLowerCase() === regionalAdminCountry.toLowerCase()
  );

  if (!region) {
    throw new Error(`Missing active region for ${regionalAdminCountry}. Run corepack pnpm prisma:seed first.`);
  }

  const passwordHash = await bcrypt.hash(regionalAdminPassword, 12);

  const regionalAdminUser = await prisma.user.upsert({
    where: { email: regionalAdminEmail },
    update: {
      passwordHash,
      fullName: regionalAdminName,
      accountStatus: AccountStatus.active,
      roles: { set: [RoleCode.regional_admin] },
      deletedAt: null
    },
    create: {
      email: regionalAdminEmail,
      passwordHash,
      fullName: regionalAdminName,
      accountStatus: AccountStatus.active,
      roles: [RoleCode.regional_admin],
      deletedAt: null
    }
  });

  await prisma.regionalAdminProfile.upsert({
    where: { userId: regionalAdminUser.id },
    update: {
      regionId: region.id,
      status: "active",
      assignedByUserId: regionalAdminUser.id,
      deletedAt: null
    },
    create: {
      userId: regionalAdminUser.id,
      regionId: region.id,
      assignedByUserId: regionalAdminUser.id,
      deletedAt: null
    }
  });

  console.log(`Seeded development Regional Admin for ${region.name}.`);
  console.log(`Email: ${regionalAdminEmail}`);
  console.log(`Password: ${regionalAdminPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
