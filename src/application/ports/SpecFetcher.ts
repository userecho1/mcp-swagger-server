import type { OpenApiSpec } from "../../domain/entities/OpenApiSpec.js";

export interface SpecFetcher {
  fetchSpec(): Promise<OpenApiSpec>;
}
