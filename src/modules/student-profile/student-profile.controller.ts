import { asyncHandler, sendSuccess } from "../../shared/http";
import {
  getStudentProfileByUserId,
  submitMyStudentProfile,
  updateMyStudentProfile,
  approveCommunityGuidelines
} from "./student-profile.service";
import { updateStudentProfileSchema } from "./student-profile.validation";

export const getMyStudentProfileHandler = asyncHandler(async (req, res) => {
  const profile = await getStudentProfileByUserId(req.authUser!.id);
  sendSuccess(res, { profile });
});

export const updateMyStudentProfileHandler = asyncHandler(async (req, res) => {
  const input = updateStudentProfileSchema.parse(req.body);
  const profile = await updateMyStudentProfile(req.authUser!.id, input);
  sendSuccess(res, { profile });
});

export const submitMyStudentProfileHandler = asyncHandler(async (req, res) => {
  const profile = await submitMyStudentProfile({
    userId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });

  sendSuccess(res, { profile });
});

export const approveCommunityGuidelinesHandler = asyncHandler(async (req, res) => {
  const profile = await approveCommunityGuidelines(req.authUser!.id);
  sendSuccess(res, { 
    message: "Community guidelines approved successfully.",
    profile 
  });
});
