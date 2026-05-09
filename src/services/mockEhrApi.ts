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
  attempt: number;
};

type MockUpdateRequest = {
  requestId: string;
};

export async function startPatientDataUpdate(
  input: MockEhrRefreshInput
): Promise<MockUpdateRequest> {
  return {
    requestId: `${input.patientId}:${input.studyId}:${input.endpoint}:${input.attempt}`
  };
}

export async function getPatientDataRetrievalStatus(
  input: MockEhrRefreshInput & MockUpdateRequest
): Promise<MockEhrRefreshResult> {
  const endpoint = input.endpoint.toLowerCase();

  if (endpoint.includes("transient") && input.attempt === 1) {
    return {
      success: false,
      type: "TRANSIENT",
      message: "Mock EHR temporary outage"
    };
  }

  if (endpoint.includes("rate") && input.attempt === 1) {
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

export async function refreshFromMockEhr(
  input: MockEhrRefreshInput
): Promise<MockEhrRefreshResult> {
  const updateRequest = await startPatientDataUpdate(input);

  return getPatientDataRetrievalStatus({
    ...input,
    requestId: updateRequest.requestId
  });
}
