import fs from "fs";
import { parsePdf2pressLogs } from "./parsePdf2pressLogs.js";

async function main() {
  console.log("Dossier courant :", process.cwd());

  const rawText = fs.readFileSync("./log-test-pdf2press.json", "utf8");
  const rawJson = JSON.parse(rawText);

  const report = parsePdf2pressLogs(rawJson);

  console.log("===== RAPPORT STRUCTURÉ PDF2PRESS =====");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("Erreur dans test-parse :", err);
});
