import { PrismaClient } from '@prisma/client';
import readline from 'readline';

const prisma = new PrismaClient();

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  
  if (!query) {
    console.error("Please provide a user ID, email, name, or phone number.");
    console.error("Usage: npx ts-node scripts/reverse-onboarding.ts <query>");
    process.exit(1);
  }

  console.log(`Searching for user matching: "${query}"...`);

  // Handle MongoDB ObjectId length for ID searches
  const isObjectId = query.length === 24 && /^[a-fA-F0-9]{24}$/.test(query);

  const orConditions: any[] = [
    { email: { equals: query, mode: 'insensitive' } },
    { fullName: { contains: query, mode: 'insensitive' } },
    { phone: { contains: query } },
    { 
      studentProfile: { 
        is: { fullNameEnglish: { contains: query, mode: 'insensitive' } } 
      } 
    },
    { 
      studentProfile: { 
        is: { currentPhone: { contains: query } } 
      } 
    },
  ];

  if (isObjectId) {
    orConditions.push({ id: query });
  }

  const users = await prisma.user.findMany({
    where: {
      OR: orConditions,
      roles: {
        has: 'student'
      }
    },
    include: {
      studentProfile: true
    }
  });

  if (users.length === 0) {
    console.error("No student found matching your query.");
    process.exit(1);
  }

  if (users.length > 1) {
    console.error(`Found ${users.length} students matching your query. Please be more specific (e.g., use their exact email or User ID):`);
    for (const u of users) {
      console.error(`- ID: ${u.id} | Name: ${u.fullName} | Email: ${u.email} | Phone: ${u.phone}`);
    }
    process.exit(1);
  }

  const user = users[0];
  console.log(`Found user: ${user.fullName} (${user.email}) - ID: ${user.id}`);

  if (!user.studentProfile) {
    console.log("This user does not have a Student Profile. They are already in a pre-onboarded state.");
  } else {
    console.log("Student Profile found. Reversing onboarding...");
  }

  // This deletes every document the user owns, not only onboarding ones, and it cannot be
  // undone. Require the operator to retype the email so a mistyped search term can't wipe
  // the wrong student. Pass --yes to skip when scripting.
  if (!process.argv.includes("--yes")) {
    const answer = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`\nType "${user.email}" to confirm deletion: `, (value) => {
        rl.close();
        resolve(value.trim());
      });
    });

    if (answer !== user.email) {
      console.error("Confirmation did not match. Nothing was deleted.");
      process.exit(1);
    }
  }

  // Start a transaction to delete the profile and associated documents
  await prisma.$transaction(async (tx) => {
    // Delete documents owned by the user
    const deletedDocs = await tx.document.deleteMany({
      where: { ownerUserId: user.id }
    });
    console.log(`Deleted ${deletedDocs.count} associated document(s).`);

    // If the student profile exists, delete it
    if (user.studentProfile) {
      await tx.studentProfile.delete({
        where: { userId: user.id }
      });
      console.log(`Deleted Student Profile.`);
    }
  });

  console.log("\nSuccess! The student's onboarding has been reversed.");
  console.log("They can now log in with their existing credentials and start the onboarding process from scratch.");
}

main()
  .catch(err => {
    console.error("Error occurred:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
