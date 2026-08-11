import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { AccountStatus, PrismaClient, RoleCode } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

const adminEmail = process.env.DEV_ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.DEV_ADMIN_PASSWORD || "AdminPassword123!";
const adminName = "Development Master Admin";

async function main() {
  // Allowed seeding in production by admin request

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      fullName: adminName,
      accountStatus: AccountStatus.active,
      roles: { set: [RoleCode.master_admin] },
      deletedAt: null
    },
    create: {
      email: adminEmail,
      passwordHash,
      fullName: adminName,
      accountStatus: AccountStatus.active,
      roles: [RoleCode.master_admin],
      deletedAt: null
    }
  });

  console.log("Seeded development Master Admin.");
  console.log(`Email: ${adminEmail}`);
  console.log(`Password: ${adminPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
