// Drives components/owner/ownerReportDoc.ts as a pure builder — no browser, no database.
import { register } from "node:module";
import ts from "typescript";
import fs from "node:fs";
const src = fs.readFileSync(new URL("../../../components/owner/ownerReportDoc.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const M = await import(url);
export const { buildReportHtml, buildReportTables, moneyInHand } = M;
