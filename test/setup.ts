import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/db.ts opens its file once per process, on first import. Test files that never set DB_PATH
// (deal, realdeal...) used to open ./data/radar.sqlite — the developer's real database — and every
// later file wrote its fixtures there too, so a second `bun test` failed on leftovers.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-ofertas-test-")), "radar.sqlite");
