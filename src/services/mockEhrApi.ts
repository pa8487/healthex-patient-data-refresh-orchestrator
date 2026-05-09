export type MockEhrFailureType = "TRANSIENT" | "RATE_LIMIT" | "PERMANENT";

export type MockEhrRefreshResult =
  | { success: true }
  | {
      success: false;
      type: MockEhrFailureType;
      message: string;
    };

export type MockEhrRefreshInput = {
  patientId: string;
  studyId: string;
  endpoint: string;
};

export async function refreshFromMockEhr(
  input: MockEhrRefreshInput
): Promise<MockEhrRefreshResult> {
  const endpoint = input.endpoint.toLowerCase();

  if (endpoint.includes("transient")) {
    return {
      success: false,
      type: "TRANSIENT",
      message: "Mock EHR temporary outage"
    };
  }

  if (endpoint.includes("rate")) {
    return {
      success: false,
      type: "RATE_LIMIT",
      message: "Mock EHR rate limit exceeded"
    };
  }

  if (endpoint.includes("permanent")) {
    return {
      success: false,
      type: "PERMANENT",
      message: "Mock EHR rejected the refresh request"
    };
  }

  return { success: true };
}
