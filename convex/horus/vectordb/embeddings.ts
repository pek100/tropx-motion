/**
 * Embedding Generation
 *
 * Vertex AI text-embedding-004 integration for vector search.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

export const EMBEDDING_CONFIG = {
  MODEL: "text-embedding-004",
  DIMENSIONS: 768,
  LOCATION: "us-central1",
  // Batch size for embedding requests
  MAX_BATCH_SIZE: 250,
  // Task type for embeddings
  TASK_TYPES: {
    RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
    RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
    SEMANTIC_SIMILARITY: "SEMANTIC_SIMILARITY",
    CLASSIFICATION: "CLASSIFICATION",
  },
};

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  textLength: number;
}

// ─────────────────────────────────────────────────────────────────
// Embedding Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Generate embedding for a single text.
 */
export const generateEmbedding = action({
  args: {
    text: v.string(),
    taskType: v.optional(v.string()),
  },
  handler: async (ctx, { text, taskType }): Promise<EmbeddingResult> => {
    const projectId = process.env.VERTEX_AI_PROJECT_ID;
    const location = process.env.VERTEX_AI_LOCATION || EMBEDDING_CONFIG.LOCATION;

    if (!projectId) {
      throw new Error("VERTEX_AI_PROJECT_ID environment variable is not set");
    }

    // Get access token
    const accessToken = await getAccessToken();

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${EMBEDDING_CONFIG.MODEL}:predict`;

    const requestBody = {
      instances: [
        {
          content: text,
          task_type: taskType || EMBEDDING_CONFIG.TASK_TYPES.RETRIEVAL_DOCUMENT,
        },
      ],
    };

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
      throw new Error(`Embedding API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const embedding = data.predictions?.[0]?.embeddings?.values;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid embedding response");
    }

    return {
      embedding,
      textLength: text.length,
    };
  },
});

/**
 * Generate embeddings for multiple texts (batch).
 */
export const generateEmbeddingsBatch = action({
  args: {
    texts: v.array(v.string()),
    taskType: v.optional(v.string()),
  },
  handler: async (ctx, { texts, taskType }): Promise<EmbeddingResult[]> => {
    if (texts.length === 0) return [];
    if (texts.length > EMBEDDING_CONFIG.MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size exceeds maximum of ${EMBEDDING_CONFIG.MAX_BATCH_SIZE}`
      );
    }

    const projectId = process.env.VERTEX_AI_PROJECT_ID;
    const location = process.env.VERTEX_AI_LOCATION || EMBEDDING_CONFIG.LOCATION;

    if (!projectId) {
      throw new Error("VERTEX_AI_PROJECT_ID environment variable is not set");
    }

    const accessToken = await getAccessToken();

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${EMBEDDING_CONFIG.MODEL}:predict`;

    const requestBody = {
      instances: texts.map((text) => ({
        content: text,
        task_type: taskType || EMBEDDING_CONFIG.TASK_TYPES.RETRIEVAL_DOCUMENT,
      })),
    };

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
      throw new Error(`Embedding API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const predictions = data.predictions || [];

    return predictions.map(
      (pred: { embeddings?: { values?: number[] } }, idx: number) => ({
        embedding: pred.embeddings?.values || [],
        textLength: texts[idx].length,
      })
    );
  },
});

/**
 * Generate query embedding (uses RETRIEVAL_QUERY task type).
 */
export const generateQueryEmbedding = action({
  args: {
    query: v.string(),
  },
  handler: async (ctx, { query }): Promise<number[]> => {
    const result = await ctx.runAction(
      // @ts-expect-error - internal action reference
      generateEmbedding,
      {
        text: query,
        taskType: EMBEDDING_CONFIG.TASK_TYPES.RETRIEVAL_QUERY,
      }
    );
    return result.embedding;
  },
});

// ─────────────────────────────────────────────────────────────────
// Access Token Helper
// ─────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  // Try service account JSON first
  const serviceAccountKey = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (serviceAccountKey) {
    return getAccessTokenFromServiceAccount(JSON.parse(serviceAccountKey));
  }

  // Try metadata server (GCP)
  try {
    const metadataResponse = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } }
    );
    if (metadataResponse.ok) {
      const data = await metadataResponse.json();
      return data.access_token;
    }
  } catch {
    // Not on GCP
  }

  // Direct token
  const directToken = process.env.VERTEX_AI_ACCESS_TOKEN;
  if (directToken) return directToken;

  throw new Error("No valid authentication method found for Vertex AI");
}

async function getAccessTokenFromServiceAccount(credentials: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  };

  const jwt = await signJWT(header, payload, credentials.private_key);

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

async function signJWT(
  header: object,
  payload: object,
  privateKeyPem: string
): Promise<string> {
  const encoder = new TextEncoder();
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const privateKey = await importPrivateKey(privateKeyPem);
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

async function importPrivateKey(pem: string): Promise<CryptoKey> {
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

function base64urlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Normalize text for embedding (lowercase, trim, collapse whitespace).
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}
