import axios, { type AxiosInstance } from "axios";
import type { SpecFetcher } from "../../application/ports/SpecFetcher.js";
import type { OpenApiSpec } from "../../domain/entities/OpenApiSpec.js";

export class OpenApiHttpFetcher implements SpecFetcher {
  private readonly httpClient: AxiosInstance;

  constructor(private readonly specUrl: string) {
    this.httpClient = axios.create({
      timeout: 10_000,
    });
  }

  async fetchSpec(): Promise<OpenApiSpec> {
    const response = await this.httpClient.get<OpenApiSpec>(this.specUrl);
    return response.data;
  }
}
