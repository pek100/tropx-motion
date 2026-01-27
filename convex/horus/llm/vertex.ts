/**
 * Vertex AI Client for Horus
 *
 * Gemini 2.5 Flash integration with structured output support.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import type { TokenUsage } from "../types";

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

export const VERTEX_CONFIG = {
  // Gemini 2.5 Flash - supports up to 65535 output tokens
  MODEL: "gemini-2.5-flash",
  LOCATION: "us-central1",
  // Pricing per 1M tokens (Gemini 2.5 Flash pricing)
  PRICING: {
    INPUT_PER_1M: 0.15,
    OUTPUT_PER_1M: 0.60,
  },
  // Default generation config
  GENERATION_CONFIG: {
    temperature: 0.2,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 65535, // Gemini 2.5 Flash max
  },
  // Safety settings (permissive for clinical content)
  SAFETY_SETTINGS: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface VertexRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface VertexResponse {
  text: string;
  tokenUsage: TokenUsage;
  finishReason: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GroundingChunk[];
  groundingSupports?: Array<{
    segment: { startIndex: number; endIndex: number; text: string };
    groundingChunkIndices: number[];
    confidenceScores: number[];
  }>;
}

export interface VertexGroundedResponse extends VertexResponse {
  groundingMetadata?: GroundingMetadata;
}

// ─────────────────────────────────────────────────────────────────
// Main LLM Call Action
// ─────────────────────────────────────────────────────────────────

/**
 * Call Vertex AI Gemini model.
 * This is a Convex action that makes external API calls.
 */
export const callVertexAI = action({
  args: {
    systemPrompt: v.string(),
    userPrompt: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    responseSchema: v.optional(v.any()), // JSON Schema for structured output
  },
  handler: async (ctx, args): Promise<VertexResponse> => {
    const projectId = process.env.VERTEX_AI_PROJECT_ID;
    const location = process.env.VERTEX_AI_LOCATION || VERTEX_CONFIG.LOCATION;

    if (!projectId) {
      throw new Error("VERTEX_AI_PROJECT_ID environment variable is not set");
    }

    // Get access token using Google Cloud default credentials
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
      console.log("[Vertex AI] Got access token (length:", accessToken.length, ")");
    } catch (tokenError) {
      console.error("[Vertex AI] Failed to get access token:", tokenError);
      throw tokenError;
    }

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${VERTEX_CONFIG.MODEL}:generateContent`;

    // Build generation config
    const generationConfig: Record<string, unknown> = {
      ...VERTEX_CONFIG.GENERATION_CONFIG,
      temperature: args.temperature ?? VERTEX_CONFIG.GENERATION_CONFIG.temperature,
      maxOutputTokens: args.maxTokens ?? VERTEX_CONFIG.GENERATION_CONFIG.maxOutputTokens,
      // Disable thinking mode to prevent token budget being consumed by internal reasoning
      // See: https://discuss.ai.google.dev/t/truncated-response-issue-with-gemini-2-5-flash-preview/81258
      thinkingConfig: {
        thinkingBudget: 0,
      },
    };

    // If response schema provided, enable JSON mode
    if (args.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = args.responseSchema;
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: args.userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: args.systemPrompt }],
      },
      generationConfig,
      safetySettings: VERTEX_CONFIG.SAFETY_SETTINGS,
    };

    console.log("[Vertex AI] Calling API:", {
      model: VERTEX_CONFIG.MODEL,
      location,
      hasSchema: !!args.responseSchema,
      promptLength: args.userPrompt.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("[Vertex AI] Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Vertex AI] API Error:", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        endpoint,
        hasSchema: !!args.responseSchema,
      });
      throw new Error(`Vertex AI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Log successful response metadata
    console.log("[Vertex AI] Response received:", {
      finishReason: data.candidates?.[0]?.finishReason,
      promptTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      hasContent: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
    });

    // Extract response text
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error("No response candidate from Vertex AI");
    }

    const text = candidate.content?.parts?.[0]?.text || "";
    const finishReason = candidate.finishReason || "UNKNOWN";

    // Handle truncated responses
    if (finishReason === "MAX_TOKENS") {
      console.error("[Vertex AI] Response truncated (MAX_TOKENS):", {
        outputTokens: data.usageMetadata?.candidatesTokenCount,
        textLength: text.length,
        textPreview: text.slice(0, 500) + "...",
      });
      throw new Error(`Vertex AI response truncated (MAX_TOKENS). Output: ${data.usageMetadata?.candidatesTokenCount} tokens. Try reducing prompt size or increasing maxOutputTokens.`);
    }

    // Extract token usage
    const usageMetadata = data.usageMetadata || {};
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;
    const totalTokens = inputTokens + outputTokens;

    // Calculate cost
    const estimatedCost =
      (inputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.INPUT_PER_1M +
      (outputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.OUTPUT_PER_1M;

    return {
      text,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost,
      },
      finishReason,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Grounded LLM Call (with Google Search)
// ─────────────────────────────────────────────────────────────────

/**
 * Call Vertex AI Gemini model with Google Search grounding.
 * Returns response with web search citations - no external API key needed.
 */
export const callVertexAIGrounded = action({
  args: {
    systemPrompt: v.string(),
    userPrompt: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    responseSchema: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<VertexGroundedResponse> => {
    const projectId = process.env.VERTEX_AI_PROJECT_ID;
    const location = process.env.VERTEX_AI_LOCATION || VERTEX_CONFIG.LOCATION;

    if (!projectId) {
      throw new Error("VERTEX_AI_PROJECT_ID environment variable is not set");
    }

    const accessToken = await getAccessToken();

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${VERTEX_CONFIG.MODEL}:generateContent`;

    // Build generation config
    const generationConfig: Record<string, unknown> = {
      ...VERTEX_CONFIG.GENERATION_CONFIG,
      temperature: args.temperature ?? 0.3,
      maxOutputTokens: args.maxTokens ?? 8192,
      thinkingConfig: { thinkingBudget: 0 },
    };

    // If response schema provided, enable JSON mode
    if (args.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = args.responseSchema;
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: args.userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: args.systemPrompt }],
      },
      generationConfig,
      safetySettings: VERTEX_CONFIG.SAFETY_SETTINGS,
      // Enable Google Search grounding (new API format as of late 2025)
      tools: [
        {
          google_search: {},
        },
      ],
    };

    console.log("[Vertex AI Grounded] Calling API with Google Search enabled:", {
      model: VERTEX_CONFIG.MODEL,
      location,
      promptLength: args.userPrompt.length,
      hasResponseSchema: !!args.responseSchema,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Vertex AI Grounded] API Error:", response.status, errorText);
      throw new Error(`Vertex AI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error("No response candidate from Vertex AI");
    }

    const text = candidate.content?.parts?.[0]?.text || "";
    const finishReason = candidate.finishReason || "UNKNOWN";

    // Extract grounding metadata (search results)
    const groundingMetadata = candidate.groundingMetadata as GroundingMetadata | undefined;

    if (groundingMetadata) {
      console.log("[Vertex AI Grounded] Search queries:", groundingMetadata.webSearchQueries);
      console.log("[Vertex AI Grounded] Sources found:", groundingMetadata.groundingChunks?.length || 0);
      console.log("[Vertex AI Grounded] Supports found:", groundingMetadata.groundingSupports?.length || 0);
      // Log first few chunks for debugging
      if (groundingMetadata.groundingChunks?.length) {
        console.log("[Vertex AI Grounded] First 3 chunks:",
          groundingMetadata.groundingChunks.slice(0, 3).map(c => ({
            uri: c.web?.uri?.substring(0, 80),
            title: c.web?.title?.substring(0, 40),
          }))
        );
      }
    } else {
      console.log("[Vertex AI Grounded] No grounding metadata in response - API may not have performed search");
    }

    // Extract token usage
    const usageMetadata = data.usageMetadata || {};
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;
    const totalTokens = inputTokens + outputTokens;

    const estimatedCost =
      (inputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.INPUT_PER_1M +
      (outputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.OUTPUT_PER_1M;

    return {
      text,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost,
      },
      finishReason,
      groundingMetadata,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Access Token Helper
// ─────────────────────────────────────────────────────────────────

/**
 * Get Google Cloud access token.
 * Uses Application Default Credentials (ADC) or service account key.
 */
async function getAccessToken(): Promise<string> {
  // Option 1: Use GOOGLE_APPLICATION_CREDENTIALS env var (service account JSON)
  const serviceAccountKey = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountKey) {
    return getAccessTokenFromServiceAccount(JSON.parse(serviceAccountKey));
  }

  // Option 2: Use metadata server (when running on GCP)
  try {
    const metadataResponse = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
      }
    );

    if (metadataResponse.ok) {
      const data = await metadataResponse.json();
      return data.access_token;
    }
  } catch {
    // Not running on GCP, try next option
  }

  // Option 3: Direct access token (for development)
  const directToken = process.env.VERTEX_AI_ACCESS_TOKEN;
  if (directToken) {
    return directToken;
  }

  throw new Error(
    "No valid authentication method found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON, " +
      "run on GCP with default credentials, or set VERTEX_AI_ACCESS_TOKEN."
  );
}

/**
 * Generate access token from service account credentials.
 */
async function getAccessTokenFromServiceAccount(
  credentials: {
    client_email: string;
    private_key: string;
    token_uri?: string;
  }
): Promise<string> {
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";

  // Create JWT for token request
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  };

  // Sign JWT (using Web Crypto API)
  const jwt = await signJWT(header, payload, credentials.private_key);

  // Exchange JWT for access token
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Sign JWT using RSA-SHA256.
 */
async function signJWT(
  header: object,
  payload: object,
  privateKeyPem: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Base64url encode header and payload
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  // Import private key
  const privateKey = await importPrivateKey(privateKeyPem);

  // Sign
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(signatureInput)
  );

  const signatureB64 = base64urlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${signatureInput}.${signatureB64}`;
}

/**
 * Import PEM private key for Web Crypto.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and convert to binary
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Base64url encode (RFC 4648).
 */
function base64urlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate estimated cost from token counts.
 */
export function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.INPUT_PER_1M +
    (outputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.OUTPUT_PER_1M
  );
}

/**
 * Aggregate token usage from multiple calls.
 */
export function aggregateTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
      estimatedCost: acc.estimatedCost + usage.estimatedCost,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }
  );
}
