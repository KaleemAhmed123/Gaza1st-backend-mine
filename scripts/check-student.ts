import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  
  if (!query) {
    console.error("Please provide a student's name or mobile number, or use 'all' for recent signups.");
    console.error("Usage: npx ts-node scripts/check-student.ts <name | phone | all>");
    process.exit(1);
  }

  let users = [];

  if (query.toLowerCase() === 'all') {
    console.log(`Fetching the 20 most recent student signups...`);
    users = await prisma.user.findMany({
      where: {
        roles: {
          has: 'student'
        }
      },
      include: {
        studentProfile: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20
    });
  } else {
    console.log(`Searching for student matching: "${query}"...`);
    // We search by name or phone across both the User and StudentProfile models.
    users = await prisma.user.findMany({
      where: {
        OR: [
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
        ],
        roles: {
          has: 'student'
        }
      },
      include: {
        studentProfile: true
      }
    });
  }

  if (users.length === 0) {
    console.log("No students found matching your query.");
    return;
  }

  console.log(`Found ${users.length} student(s):\n`);

  for (const user of users) {
    console.log("=========================================");
    console.log(`User ID: ${user.id}`);
    console.log(`Name: ${user.fullName}`);
    console.log(`Email: ${user.email} (Verified: ${user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : 'NO'})`);
    console.log(`Phone: ${user.phone || 'N/A'}`);
    console.log(`Account Status: ${user.accountStatus}`);
    
    if (user.studentProfile) {
      const p = user.studentProfile;
      console.log("\n--- Student Profile ---");
      console.log(`English Name: ${p.fullNameEnglish || 'N/A'}`);
      console.log(`Current Phone: ${p.currentPhone || 'N/A'}`);
      console.log(`Profile Status: ${p.profileStatus}`);
      
      console.log("\n--- Passport Data ---");
      console.log(`Passport Status: ${p.passportStatus || 'N/A'}`);
      console.log(`Passport Location: ${p.passportLocation || 'N/A'}`);
      console.log(`Passport Number: ${p.passportNumber || 'N/A'}`);
      console.log(`Passport Expiry: ${p.passportExpiry ? p.passportExpiry.toISOString().split('T')[0] : 'N/A'}`);
      
      console.log("\n--- Other Info ---");
      console.log(`Date of Birth: ${p.dateOfBirth ? p.dateOfBirth.toISOString().split('T')[0] : 'N/A'}`);
      console.log(`Gaza Location: ${p.locationInGaza || 'N/A'}`);
      console.log(`Original City: ${p.originalCity || 'N/A'}`);
      console.log(`National ID: ${p.nationalIdNumber || 'N/A'}`);
      console.log(`Emergency Contact: ${p.emergencyContactFirstName || 'N/A'} (${p.emergencyContactRelation || 'N/A'})`);
      console.log(`Emergency Phone: ${p.emergencyContactPhone || 'N/A'}`);
      console.log(`Emergency Email: ${p.emergencyContactEmail || 'N/A'}`);
      console.log(`Has Offer Self Reported: ${p.hasOfferSelfReported ? 'Yes' : 'No'}`);
      console.log(`Has Verified Offer: ${p.hasVerifiedOffer ? 'Yes' : 'No'}`);
      console.log(`English MOI: ${p.englishMoi ? 'Yes' : 'No'}`);
    } else {
      console.log("\nNo student profile found for this user.");
    }
    console.log("=========================================\n");
  }
}

main()
  .catch(err => {
    console.error("Error occurred:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
