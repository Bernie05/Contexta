import "server-only";
import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { DATA_DIR } from "./db";

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

env.cacheDir = path.join(DATA_DIR, "models");

const globalForModel = globalThis as unknown as { contextaEmbedder?: Promise<FeatureExtractionPipeline> };

function embedder(): Promise<FeatureExtractionPipeline> {
  // The model downloads once (~25MB) on first use, then loads from DATA_DIR/models.
  globalForModel.contextaEmbedder ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
  return globalForModel.contextaEmbedder;
}

/** Embeds texts into L2-normalized vectors, so cosine similarity is a plain dot product. */
export async function embed(texts: string[], batchSize = 16): Promise<Float32Array[]> {
  const model = await embedder();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await model(batch, { pooling: "mean", normalize: true });
    const [rows, dims] = tensor.dims as [number, number];
    const data = tensor.data as Float32Array;
    for (let r = 0; r < rows; r++) out.push(data.slice(r * dims, (r + 1) * dims));
  }
  return out;
}

/** A vector in pgvector's text format, e.g. "[0.1,0.2]". */
export function toVectorLiteral(vec: Float32Array): string {
  return `[${vec.join(",")}]`;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
