import type { Prisma } from "@prisma/client";
import { ApiError } from "../../shared/http";

export type FinancialRules = {
  currency: string;
  livingCostRules: Record<string, Record<string, { label: string; amountPerYear: number }>>;
  durationRule: {
    completeYearsFormula: string;
  };
};

export type OfferFinancialInput = {
  countryName: string;
  courseLevel: string;
  durationYears: number;
  tuitionFeePerYear: number;
  scholarshipAmount?: number | null;
  scholarshipInterval?: string | null;
  scholarshipCoversLivingCost: boolean;
  privateFundingAmount: number;
  privateFundingInterval?: string | null;
  livingCostLocationKey?: string | null;
  livingCostForVisa?: number | null;
  boardingFees?: number | null;
};

export type OfferFinancialSummary = {
  currency: string;
  completeYears: number;
  tuitionFeePerYearCovered: boolean;
  availableFundsForYear: number;
  tuitionFeePerYear: number;
  tuitionFeePerYearGap: number;
  estimatedLivingOrBoardingCost: number;
  livingCostCovered: boolean;
  livingCostGap: number;
  livingCostSource: "configured_country_rule" | "manual_living_cost" | "boarding_fees" | "scholarship_covers_living" | "none";
};

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  return Number(value);
}

export function parseFinancialRules(value: Prisma.JsonValue): FinancialRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(500, "Offer financial rules config is invalid");
  }

  const rules = value as Partial<FinancialRules>;
  if (!rules.currency || !rules.livingCostRules || !rules.durationRule) {
    throw new ApiError(500, "Offer financial rules config is incomplete");
  }

  return rules as FinancialRules;
}

export function calculateOfferFinancialSummary(
  rules: FinancialRules,
  input: OfferFinancialInput
): OfferFinancialSummary {
  const scholarshipRaw = input.scholarshipAmount ?? 0;
  const scholarshipAnnual = input.scholarshipInterval === "one_time"
    ? (scholarshipRaw / Math.max(1, input.durationYears))
    : scholarshipRaw;
  
  const privateFundingAnnual = input.privateFundingInterval === "one_time"
    ? (input.privateFundingAmount / Math.max(1, input.durationYears))
    : input.privateFundingAmount;
  const availableFundsForYear = scholarshipAnnual + privateFundingAnnual;
  const tuitionFeePerYearGap = Math.max(input.tuitionFeePerYear - availableFundsForYear, 0);
  const tuitionFeePerYearCovered = tuitionFeePerYearGap === 0;
  const completeYears = Math.floor(input.durationYears);

  let estimatedLivingOrBoardingCost = 0;
  let livingCostSource: OfferFinancialSummary["livingCostSource"] = "none";

  if (input.scholarshipCoversLivingCost) {
    livingCostSource = "scholarship_covers_living";
  }

  if (input.courseLevel.toLowerCase() === "residential independent school") {
    estimatedLivingOrBoardingCost = input.boardingFees ?? 0;
    livingCostSource = "boarding_fees";
  } else if (input.countryName.toLowerCase() === "uk" && input.livingCostLocationKey) {
    const countryRules = rules.livingCostRules.UK;
    const locationRule = countryRules?.[input.livingCostLocationKey];

    if (!locationRule) {
      throw new ApiError(400, "Invalid living cost location for UK offer");
    }

    estimatedLivingOrBoardingCost = locationRule.amountPerYear;
    livingCostSource = "configured_country_rule";
  } else if (input.countryName.toLowerCase() !== "uk") {
    estimatedLivingOrBoardingCost = input.livingCostForVisa ?? 0;
    livingCostSource = "manual_living_cost";
  }

  if (input.scholarshipCoversLivingCost) {
    return {
      currency: rules.currency,
      completeYears,
      tuitionFeePerYearCovered,
      availableFundsForYear,
      tuitionFeePerYear: input.tuitionFeePerYear,
      tuitionFeePerYearGap,
      estimatedLivingOrBoardingCost,
      livingCostCovered: true,
      livingCostGap: 0,
      livingCostSource
    };
  }

  if (!tuitionFeePerYearCovered) {
    return {
      currency: rules.currency,
      completeYears,
      tuitionFeePerYearCovered,
      availableFundsForYear,
      tuitionFeePerYear: input.tuitionFeePerYear,
      tuitionFeePerYearGap,
      estimatedLivingOrBoardingCost,
      livingCostCovered: false,
      livingCostGap: estimatedLivingOrBoardingCost,
      livingCostSource
    };
  }

  const excessAmount = Math.max(availableFundsForYear - input.tuitionFeePerYear, 0);
  const livingCostGap = Math.max(estimatedLivingOrBoardingCost - excessAmount, 0);

  return {
    currency: rules.currency,
    completeYears,
    tuitionFeePerYearCovered,
    availableFundsForYear,
    tuitionFeePerYear: input.tuitionFeePerYear,
    tuitionFeePerYearGap,
    estimatedLivingOrBoardingCost,
    livingCostCovered: livingCostGap === 0,
    livingCostGap,
    livingCostSource
  };
}

export function decimalToNumber(value: number | string | null | undefined) {
  return toNumber(value) ?? 0;
}
