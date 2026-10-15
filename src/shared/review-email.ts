import { RoleCode } from "@prisma/client";
import { prisma } from "../db/prisma";
import { sendEmailBestEffort } from "./email";

export async function notifyMasterAdminsOfProfileSubmission(input: {
  studentName: string;
  studentEmail: string;
}) {
  const admins = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.master_admin }
    },
    select: { email: true }
  });

  sendEmailBestEffort({
    to: admins.map((admin) => admin.email),
    subject: "Gaza1st profile submitted for review",
    text: `${input.studentName} (${input.studentEmail}) submitted their profile for review.`
  });
}

export async function notifyAdminsOfOfferReview(input: {
  studentName: string;
  studentEmail: string;
  offerId: string;
  regionId: string;
  universityName: string;
  courseName: string;
  reason: "submitted" | "edited_after_approval";
}) {
  const regionalAdmins = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.regional_admin },
      regionalAdminProfile: {
        regionId: input.regionId,
        status: "active",
        deletedAt: null
      }
    },
    select: { email: true }
  });

  let recipients = regionalAdmins.map((admin) => admin.email);

  if (recipients.length === 0) {
    const masterAdmins = await prisma.user.findMany({
      where: {
        deletedAt: null,
        accountStatus: "active",
        roles: { has: RoleCode.master_admin }
      },
      select: { email: true }
    });
    recipients = masterAdmins.map((admin) => admin.email);
  }

  const actionText =
    input.reason === "edited_after_approval" ? "edited an approved offer" : "submitted an offer";

  sendEmailBestEffort({
    to: recipients,
    subject: "Gaza1st offer needs review",
    text: `${input.studentName} (${input.studentEmail}) ${actionText} for ${input.universityName} - ${input.courseName}.\n\nOffer ID: ${input.offerId}`
  });
}
