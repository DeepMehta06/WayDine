import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// Tests must stub fetch; an unstubbed call fails instead of reaching a live API.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`Unmocked network request in a test: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;
