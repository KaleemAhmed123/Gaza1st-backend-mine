import { prisma } from "../src/db/prisma";

// One-time grandfather migration: mark every existing user as email-verified so that
// turning on verification enforcement does not lock out accounts created before it existed.
// Sets emailVerifiedAt = now for users where it is null or missing.
async function main() {
  const now = new Date();

  const result = await prisma.$runCommandRaw({
    update: "User",
    updates: [
      {
        q: { $or: [{ emailVerifiedAt: null }, { emailVerifiedAt: { $exists: false } }] },
        u: { $set: { emailVerifiedAt: now } },
        multi: true
      }
    ]
  });

  console.log("User emailVerifiedAt backfill:", JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
