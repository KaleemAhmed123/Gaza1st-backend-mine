/**
 * csv-column-definitions.ts
 *
 * Single source of truth for all CSV export columns.
 * Used by:
 *   - Backend validation  (columns[] key whitelist per dataset)
 *   - Export services     (maps key → DB value, provides CSV header label)
 *   - Frontend            (mirrors this to render column-selection checkboxes)
 */

export type ColumnDef = {
  /** Human-readable CSV header label shown in the file and in the UI checkbox */
  label: string;
  /** Whether this column is pre-selected by default in the UI */
  default: boolean;
};

export const STUDENT_COLUMNS: Record<string, ColumnDef> = {
  studentId:                   { label: "Student ID",                    default: true  },
  fullName:                    { label: "Student Name (Arabic)",          default: true  },
  fullNameEnglish:             { label: "Student Name (English)",         default: true  },
  email:                       { label: "Email",                          default: true  },
  phone:                       { label: "Phone",                          default: true  },
  sex:                         { label: "Sex",                            default: true  },
  dateOfBirth:                 { label: "Date of Birth",                  default: true  },
  locationInGaza:              { label: "Location in Gaza",               default: true  },
  passportStatus:              { label: "Passport Status",                default: true  },
  passportLocation:            { label: "Passport Location",              default: false },
  profileStatus:               { label: "Profile Status",                 default: true  },
  consentSigned:               { label: "Consent Signed",                 default: true  },
  hasOfferSelfReported:        { label: "Has Offer (Self-Reported)",      default: false },
  hasVerifiedOffer:            { label: "Has Verified Offer",             default: true  },
  emergencyContactFirstName:   { label: "Emergency Contact Name",         default: false },
  emergencyContactRelation:    { label: "Emergency Contact Relation",     default: false },
  emergencyContactPhone:       { label: "Emergency Contact Phone",        default: false },
  accountStatus:               { label: "Account Status",                 default: false },
  studentSignupDate:           { label: "Student Signup Date",            default: true  },
  country:                     { label: "Country",                        default: true  },
  university:                  { label: "University",                     default: true  },
  offerId:                     { label: "Offer ID",                       default: true  },
  courseName:                  { label: "Course Name",                    default: true  },
  courseField:                 { label: "Course Field",                   default: true  },
  courseLevel:                 { label: "Course Level",                   default: true  },
  offerType:                   { label: "Offer Type",                     default: true  },
  durationYears:               { label: "Duration (Years)",               default: true  },
  programmeStartDate:          { label: "Programme Start Date",           default: true  },
  tuitionFeePerYear:           { label: "Tuition Fee / Year",             default: true  },
  hasScholarship:              { label: "Has Scholarship",                default: true  },
  scholarshipName:             { label: "Scholarship Name",               default: true  },
  scholarshipAmount:    { label: "Scholarship Amount / Year",      default: true  },
  scholarshipCoversLivingCost: { label: "Scholarship Covers Living Cost", default: false },
  privateFundingAmount:        { label: "Private Funding Amount",         default: true  },
  privateFundingSource:        { label: "Private Funding Source",         default: false },
  financialGap:                { label: "Financial Gap",                  default: true  },
  financialGapExists:          { label: "Financial Gap Exists",           default: true  },
  offerStatus:                 { label: "Offer Status",                   default: true  },
  approvedOffer:               { label: "Approved Offer",                 default: true  },
  activeOffer:                 { label: "Active Offer",                   default: true  },
  scholarshipExists:           { label: "Scholarship Exists",             default: true  },
  offerLetterUrl:              { label: "Offer Letter URL",               default: true  },
  scholarshipLetterUrl:        { label: "Scholarship Letter URL",         default: false },
  offerCreatedAt:              { label: "Offer Created At",               default: true  },
};

export const MENTOR_COLUMNS: Record<string, ColumnDef> = {
  mentorId:                { label: "Mentor ID",                  default: true  },
  mentorFullName:          { label: "Mentor Name",                 default: true  },
  email:                   { label: "Email",                       default: true  },
  phone:                   { label: "Phone",                       default: true  },
  universityAffiliation:   { label: "University Affiliation",      default: true  },
  volunteerStatus:         { label: "Volunteer Status",            default: true  },
  mentorSignupDate:        { label: "Mentor Signup Date",          default: true  },
  country:                 { label: "Country",                     default: true  },
  university:              { label: "University",                  default: true  },
  studentId:               { label: "Student ID",                  default: true  },
  studentName:             { label: "Student Name",                default: true  },
  offerId:                 { label: "Offer ID",                    default: true  },
  courseName:              { label: "Course Name",                 default: true  },
  courseLevel:             { label: "Course Level",                default: true  },
  tuitionFeePerYear:       { label: "Tuition Fee / Year",          default: true  },
  scholarshipAmount:{ label: "Scholarship Amount / Year",   default: true  },
  privateFundingAmount:    { label: "Private Funding Amount",      default: true  },
  financialGap:            { label: "Financial Gap",               default: true  },
  financialGapExists:      { label: "Financial Gap Exists",        default: true  },
  offerStatus:             { label: "Offer Status",                default: true  },
  approvedOffer:           { label: "Approved Offer",              default: true  },
  activeOffer:             { label: "Active Offer",                default: true  },
  offerLetterUrl:          { label: "Offer Letter URL",            default: true  },
  offerCreatedAt:          { label: "Offer Created At",            default: true  },
};

export const REGIONAL_ADMIN_COLUMNS: Record<string, ColumnDef> = {
  adminId:                 { label: "Admin ID",                    default: true  },
  adminFullName:           { label: "Admin Name",                  default: true  },
  adminEmail:              { label: "Admin Email",                 default: true  },
  adminPhone:              { label: "Admin Phone",                 default: false },
  regionCode:              { label: "Region Code",                 default: true  },
  regionName:              { label: "Region Name",                 default: true  },
  adminStatus:             { label: "Admin Status",                default: true  },
  regionalAdminSignupDate: { label: "Admin Signup Date",           default: true  },
  studentId:               { label: "Student ID",                  default: true  },
  studentName:             { label: "Student Name",                default: true  },
  studentEmail:            { label: "Student Email",               default: true  },
  offerId:                 { label: "Offer ID",                    default: true  },
  universityName:          { label: "University",                  default: true  },
  courseName:              { label: "Course Name",                 default: true  },
  courseLevel:             { label: "Course Level",                default: true  },
  tuitionFeePerYear:       { label: "Tuition Fee / Year",          default: true  },
  scholarshipAmount:{ label: "Scholarship Amount / Year",   default: true  },
  privateFundingAmount:    { label: "Private Funding Amount",      default: true  },
  financialGap:            { label: "Financial Gap",               default: true  },
  financialGapExists:      { label: "Financial Gap Exists",        default: true  },
  offerStatus:             { label: "Offer Status",                default: true  },
  approvedOffer:           { label: "Approved Offer",              default: true  },
  activeOffer:             { label: "Active Offer",                default: true  },
  offerLetterUrl:          { label: "Offer Letter URL",            default: true  },
  offerCreatedAt:          { label: "Offer Created At",            default: true  },
};

export const DATASET_COLUMNS = {
  students:        STUDENT_COLUMNS,
  mentors:         MENTOR_COLUMNS,
  regional_admins: REGIONAL_ADMIN_COLUMNS,
} as const;

export type DatasetKey = keyof typeof DATASET_COLUMNS;
