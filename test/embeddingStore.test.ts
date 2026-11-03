import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Movie } from "../src/core/types";
import { createEmbedder, type EmbedderOptions } from "../src/services/embeddings";
import { createFileStore } from "../src/services/embeddingStore";

const movie = (id: number, overview: string): Movie => ({ id, title: `M${id}`, genres: [], rating: 7, votes: 100, overview });

let dir: string;
let file: string;
let sent: string[][]; // the `input` array of every embedding request

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "emb-"));
  file = join(dir, "sub", "embeddings.json");
  sent = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body) as { input: string[] };
    sent.push(input);
    return new Response(JSON.stringify({ embeddings: input.map((t) => [t.length, 1]) }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const embedder = (over: Partial<EmbedderOptions> = {}) =>
  createEmbedder({
    url: "http://x/embed", model: "m1", queryPrefix: "q: ", documentPrefix: "d: ",
    batchSize: 64, timeoutMs: 1000, ...over,
  });

const movies = [movie(1, "a funny heist"), movie(2, "a quiet drama")];

describe("embedding store", () => {
  test("a restart reuses saved description vectors and only embeds the new query", async () => {
    await embedder({ store: createFileStore(file, 100) }).score("light and funny", movies);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3); // query + 2 descriptions

    sent = [];
    const second = await embedder({ store: createFileStore(file, 100) }).score("something darker", movies);
    expect(sent).toEqual([["q: something darker"]]); // descriptions came from disk
    expect(second.size).toBe(2);
  });


  test("a different model discards the saved vectors", async () => {
    await embedder({ store: createFileStore(file, 100) }).score("x", movies);
    sent = [];
    await embedder({ model: "m2", store: createFileStore(file, 100) }).score("x", movies);
    expect(sent[0]).toHaveLength(3); // everything embedded again
  });


  test("a corrupt cache file is ignored and replaced", async () => {
    await embedder({ store: createFileStore(file, 100) }).score("x", movies); // creates the folder and file
    writeFileSync(file, "{ not json");
    sent = [];
    const scores = await embedder({ store: createFileStore(file, 100) }).score("x", movies);
    expect(scores.size).toBe(2);
    expect(sent[0]).toHaveLength(3);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).entries)).toHaveLength(2);
  });




});
