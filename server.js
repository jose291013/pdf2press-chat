// server.js – PDF2Press Chat + parsing structuré + langues + liens d'aide

console.log(">>> SERVER RUNNING FROM:", import.meta.url);

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { parsePdf2pressLogs } from "./parsePdf2pressLogs.js";
import { buildAssistantUserContent } from "./promptMessage.js";

dotenv.config();

// -----------------------------------------------------
// Chemins de base (public/ + config/)
// -----------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chemin du fichier de config pour le tuning du prompt
const CONFIG_PATH = path.join(__dirname, "config", "prompt-config.json");

// Petit "token" d'admin pour sécuriser l'API de config
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme-en-prod";

// =====================================================
// CONFIGURATION
// =====================================================
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!ASSISTANT_ID) {
  console.error("❌ ASSISTANT_ID manquant dans .env");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY manquant dans .env");
  process.exit(1);
}
if (!process.env.PDF2PRESS_API_TOKEN) {
  console.error("❌ PDF2PRESS_API_TOKEN manquant dans .env");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log(
  ">>> SIGNATURE runs.retrieve =",
  client.beta.threads.runs.retrieve.toString()
);

// -----------------------------------------------------
// Express : middlewares de base
// -----------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------------------------------
// Servir les fichiers statiques du dossier "public"
// -> admin.html sera accessible sur /admin.html
// -----------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// -----------------------------------------------------
// Middleware simple pour protéger l'API de config
// -----------------------------------------------------
function requireAdmin(req, res, next) {
  const headerToken = req.headers["x-admin-token"];
  if (!headerToken || headerToken !== ADMIN_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// -----------------------------------------------------
// API backoffice : lire la config de prompt
// -----------------------------------------------------
app.get("/api/prompt-config", requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return res.json({}); // première fois : config vide
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const data = JSON.parse(raw || "{}");
    res.json(data);
  } catch (err) {
    console.error("Erreur lecture prompt-config.json :", err);
    res.status(500).json({ error: "Unable to read config" });
  }
});

// -----------------------------------------------------
// API backoffice : sauver / mettre à jour la config
// -----------------------------------------------------
app.post("/api/prompt-config", requireAdmin, (req, res) => {
  try {
    const payload = req.body || {};
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    console.error("Erreur écriture prompt-config.json :", err);
    res.status(500).json({ error: "Unable to save config" });
  }
});

// =====================================================
// MÉMOIRE : THREADS & LOCKS
// =====================================================

// thread par workflowSessionId
const threadsBySession = {};

// anti-collision thread creation
const creatingThreads = {};

// verrou anti-run simultané
const runLocks = {};

// =====================================================
// PDF2Press logs fetch
// =====================================================
async function fetchPdf2PressLogs(workflowSessionId) {
  const baseUrl =
    process.env.PDF2PRESS_BASE_URL || "https://awe-dev-api.aleyant.com";

  const url = `${baseUrl}/Report/log/workflowsession/${workflowSessionId}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.PDF2PRESS_API_TOKEN}`,
    },
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Erreur PDF2Press ${resp.status}: ${t.substring(0, 300)}`);
  }

  return await resp.json();
}

// =====================================================
// LIENS D'AIDE PAR TYPE DE PROBLÈME
// =====================================================
const HELP_LINKS = {
  imageResolution: {
    code: "imageResolution",
    urls: {
      fr: {
        url: "https://votre-site-aide/resolution-image",
        label: "En savoir plus sur la résolution d'image",
      },
      es: {
        url: "https://votre-site-aide/es/resolucion-imagen",
        label: "Más información sobre la resolución de imagen",
      },
      en: {
        url: "https://votre-site-aide/en/image-resolution",
        label: "More about image resolution",
      },
    },
  },
  richBlack: {
    code: "richBlack",
    urls: {
      fr: {
        url: "https://votre-site-aide/noir-enrichi",
        label: "Comprendre le noir enrichi (rich black)",
      },
      es: {
        url: "https://votre-site-aide/es/negro-enriquecido",
        label: "Más información sobre negro enriquecido (rich black)",
      },
      en: {
        url: "https://votre-site-aide/en/rich-black",
        label: "More about rich black",
      },
    },
  },
  fontsNotEmbedded: {
    code: "fontsNotEmbedded",
    urls: {
      fr: {
        url: "https://votre-site-aide/polices-pdf",
        label: "Polices non incorporées dans un PDF",
      },
      es: {
        url: "https://votre-site-aide/es/fuentes-pdf",
        label: "Fuentes no incrustadas en un PDF",
      },
      en: {
        url: "https://votre-site-aide/en/fonts-pdf",
        label: "Non-embedded fonts in a PDF",
      },
    },
  },
  distortion: {
    code: "distortion",
    urls: {
      fr: {
        url: "https://votre-site-aide/deformation",
        label: "Déformations, mise à l’échelle et proportions",
      },
      es: {
        url: "https://votre-site-aide/es/deformacion",
        label: "Deformación, escala y proporciones",
      },
      en: {
        url: "https://votre-site-aide/en/distortion",
        label: "Distortion, scaling and proportions",
      },
    },
  },
  bleed: {
    code: "bleed",
    urls: {
      fr: {
        url: "https://votre-site-aide/fond-perdu",
        label: "Qu’est-ce que le fond perdu ?",
      },
      es: {
        url: "https://votre-site-aide/es/sangrado",
        label: "¿Qué es el sangrado (bleed)?",
      },
      en: {
        url: "https://votre-site-aide/en/bleed",
        label: "What is bleed in print?",
      },
    },
  },
};

function buildHelpLinks(structuredReport, userLang) {
  const lang = userLang || "fr";
  const codes = new Set();
  const links = [];

  if (!structuredReport) return links;

  function addByCode(code) {
    const def = HELP_LINKS[code];
    if (!def || codes.has(code)) return;
    codes.add(code);
    const byLang = (def.urls && (def.urls[lang] || def.urls.fr)) || null;
    if (!byLang) return;
    links.push({
      code,
      url: byLang.url,
      label: byLang.label,
    });
  }

  const allItems = []
    .concat(structuredReport.errors || [])
    .concat(structuredReport.warnings || [])
    .concat(structuredReport.infos || [])
    .concat(structuredReport.fixes || []);

  allItems.forEach((item) => {
    const tag = item.tag || item.code || "";
    const msg = (item.message || "").toLowerCase();

    if (tag === "imageResolution" || msg.includes("dpi")) {
      addByCode("imageResolution");
    }
    if (tag === "richBlack" || msg.includes("rich black")) {
      addByCode("richBlack");
    }
    if (
      msg.includes("font") ||
      msg.includes("fonts") ||
      msg.includes("not embedded")
    ) {
      addByCode("fontsNotEmbedded");
    }
    if (msg.includes("distortion")) {
      addByCode("distortion");
    }
    if (
      tag === "bleed" ||
      tag === "bleedAdded" ||
      item.code === "bleedAdded"
    ) {
      addByCode("bleed");
    }
  });

  return links;
}

// --------------------------------------
// Détection "intelligente" du redimensionnement de pages
// à partir du rapport PDF2Press structuré
// --------------------------------------
function deriveResizeInfo(report) {
  if (!report) return null;

  const resize = {
    attempted: false, // true si on a trouvé des traces de redimensionnement
    success: null, // true / false / null (inconnu)
    details: [], // quelques infos texte pour l'IA
  };

  const fixes = Array.isArray(report.fixes) ? report.fixes : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const infos = Array.isArray(report.infos) ? report.infos : [];

  // Mots-clés "resize / scale" dans plusieurs langues
  const resizePattern =
    /(scale|scal|redimen|resize|resized|resizing|tamaño|format|größe)/i;
  // Mots-clés d’échec
  const failPattern =
    /(fail|failed|échec|error|erro|no se ha podido|nicht|konnte nicht)/i;

  // 1) Cas "succès" probable : présent dans un fix
  fixes.forEach((fix) => {
    const blob = JSON.stringify(fix.raw || fix);
    if (resizePattern.test(blob)) {
      resize.attempted = true;
      // Si pas encore défini, on considère que la présence dans "fixes" = succès
      if (resize.success === null) resize.success = !!fix.success;
      resize.details.push({
        source: "fix",
        code: fix.code || null,
        label: fix.label || null,
      });
    }
  });

  // 2) Cas "échec" probable : message d’erreur / info avec mots "resize" + "fail"
  errors.concat(infos).forEach((item) => {
    const msg = item && (item.message || JSON.stringify(item));
    if (!msg) return;
    if (resizePattern.test(msg) && failPattern.test(msg)) {
      resize.attempted = true;
      // Si on voit un message d’erreur + resize, on force success = false
      resize.success = false;
      resize.details.push({
        source: "error",
        message: msg,
      });
    }
  });

  if (!resize.attempted) return null;
  return resize;
}

// =====================================================
// ROUTE PRINCIPALE
// =====================================================
app.post("/pdf2press-chat", async (req, res) => {
  const { workflowSessionId, question } = req.body;

  if (!workflowSessionId) {
    return res.status(400).json({ error: "workflowSessionId est obligatoire" });
  }

  // RUN LOCK – empêcher les appels simultanés
  if (runLocks[workflowSessionId]) {
    console.log("⏳ Appel ignoré : run déjà en cours pour", workflowSessionId);

    return res.json({
      reply: "Analyse en cours… Veuillez patienter quelques instants.",
      threadId: threadsBySession[workflowSessionId] || null,
      workflowSessionId,
    });
  }

  runLocks[workflowSessionId] = true;

  try {
    // THREAD MANAGEMENT (anti collision)
    let threadId = threadsBySession[workflowSessionId];

    if (!threadId) {
      if (creatingThreads[workflowSessionId]) {
        // déjà en cours de création
        threadId = await creatingThreads[workflowSessionId];
      } else {
        // on crée
        creatingThreads[workflowSessionId] = (async () => {
          const thread = await client.beta.threads.create();

          if (!thread || !thread.id) {
            throw new Error("❌ OpenAI n’a pas retourné de thread.id");
          }

          console.log("🆕 Nouveau thread créé :", thread.id);
          threadsBySession[workflowSessionId] = thread.id;
          return thread.id;
        })();

        threadId = await creatingThreads[workflowSessionId];
        delete creatingThreads[workflowSessionId];
      }
    } else {
      console.log("♻️ Thread existant :", threadId);
    }

    // =========================
    // Récupération & parsing des logs PDF2Press
    // =========================
    const logs = await fetchPdf2PressLogs(workflowSessionId);
    const report = parsePdf2pressLogs(logs);

    console.log(
      "📄 Rapport PDF2Press structuré :",
      JSON.stringify(report, null, 2)
    );

    // Ajout d’un champ dérivé "resize" pour que l’IA voie bien le redimensionnement
    const resizeInfo = deriveResizeInfo(report);
    if (resizeInfo) {
      report.resize = resizeInfo;
    }

    // ----------------------------------------------------
    //  Langue + nom du fichier
    // ----------------------------------------------------
    // Nom du fichier (fallback propre)
    let fileName = "votre fichier";
    if (report && report.meta) {
      if (report.meta.fileName) {
        fileName = report.meta.fileName;
      } else if (report.meta.originalLink) {
        try {
          const urlParts = report.meta.originalLink.split("/");
          const last = urlParts[urlParts.length - 1];
          if (last) fileName = last;
        } catch (e) {
          /* ignore */
        }
      }
    }

    // Détection langue (body.lang > header > FR)
    const browserLangHeader =
      (req.headers["accept-language"] || "").toLowerCase();
    let userLang = (req.body.lang || "").toLowerCase();

    if (!userLang) {
      if (browserLangHeader.startsWith("es")) userLang = "es";
      else if (browserLangHeader.startsWith("en")) userLang = "en";
      else if (browserLangHeader.startsWith("nl")) userLang = "nl";
      else if (browserLangHeader.startsWith("de")) userLang = "de";
      else userLang = "fr";
    }

    // Instruction + exemple d’intro + titres par langue
    let languageInstruction;
    let reassuranceExample;
    let errorsHeading;
    let fixesHeading;
    let todoHeading;
    let markersHint;

    switch (userLang) {
      case "es":
        languageInstruction =
          "Responde exclusivamente en español. No utilices palabras o frases en francés ni en inglés.";
        reassuranceExample = `Hemos analizado tu archivo « ${fileName} » y lo hemos sometido a un control automático para garantizar una buena impresión.`;
        errorsHeading = "Errores detectados :";
        fixesHeading = "Reparaciones efectuadas :";
        todoHeading = "Lo que te queda por hacer :";
        markersHint =
          "En la pantalla de prueba de PDF2Press, los iconos o pastillas rojas y naranjas señalan las zonas con problemas; puedes hacer clic sobre ellas para ver exactamente dónde se encuentran en tu documento.";
        break;

      case "en":
        languageInstruction =
          "Answer exclusively in English. Do not use any French or Spanish words or headings.";
        reassuranceExample = `We have carefully analyzed your file “${fileName}” and run an automatic prepress check to ensure it will print correctly.`;
        errorsHeading = "Detected issues :";
        fixesHeading = "Fixes applied :";
        todoHeading = "What you still need to do :";
        markersHint =
          "On the PDF2Press proof screen, the red and orange markers show where the issues are; you can click them to jump directly to the exact location in your document.";
        break;

      case "nl":
        languageInstruction =
          "Antwoord uitsluitend in het Nederlands. Gebruik geen Franse of Spaanse woorden of koppen.";
        reassuranceExample = `We hebben je bestand “${fileName}” grondig gecontroleerd en automatisch gepreflight om een goede drukkwaliteit te verzekeren.`;
        errorsHeading = "Vastgestelde problemen :";
        fixesHeading = "Uitgevoerde correcties :";
        todoHeading = "Wat je nog moet doen :";
        markersHint =
          "Op het PDF2Press-proefscherm tonen de rode en oranje bolletjes waar de problemen zich bevinden; je kunt erop klikken om meteen naar de juiste plaats in je document te gaan.";
        break;

      case "de":
        languageInstruction =
          "Antworte ausschließlich auf Deutsch. Verwende keine französischen oder spanischen Wörter oder Überschriften.";
        reassuranceExample = `Wir haben Ihre Datei „${fileName}“ sorgfältig geprüft und einen automatischen Preflight durchgeführt, um eine korrekte Druckausgabe zu gewährleisten.`;
        errorsHeading = "Festgestellte Probleme :";
        fixesHeading = "Durchgeführte Korrekturen :";
        todoHeading = "Was Sie noch tun müssen :";
        markersHint =
          "Auf dem PDF2Press-Proofbildschirm zeigen die roten und orangefarbenen Markierungen, wo die Probleme liegen; Sie können darauf klicken, um direkt zur entsprechenden Stelle in Ihrem Dokument zu springen.";
        break;

      case "fr":
      default:
        userLang = "fr";
        languageInstruction =
          "Réponds exclusivement en français. N’utilise pas de phrases en espagnol ou en anglais.";
        reassuranceExample = `Nous avons bien analysé votre fichier « ${fileName} » et l’avons soumis à un contrôle automatique pour garantir une bonne impression.`;
        errorsHeading = "Erreurs détectées :";
        fixesHeading = "Réparations effectuées :";
        todoHeading = "Ce qu’il vous reste à faire :";
        markersHint =
          "Sur l’épreuve PDF2Press, les pastilles rouges et orange indiquent les zones concernées ; vous pouvez cliquer dessus pour voir précisément où se situent les problèmes sur votre document.";
        break;
    }

    // Rapport structuré pour l'assistant (JSON clean)
    const rapportTexte = JSON.stringify(report, null, 2);

    // On charge la config de prompt depuis config/prompt-config.json
    let promptConfig = {};
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
        promptConfig = JSON.parse(rawConfig || "{}");
      }
    } catch (err) {
      console.error("Erreur de lecture de prompt-config.json :", err);
      promptConfig = {};
    }

    // On construit le message utilisateur pour l'assistant
    const userContent = buildAssistantUserContent({
      rapportTexte,
      languageInstruction,
      reassuranceExample,
      errorsHeading,
      fixesHeading,
      todoHeading,
      markersHint,
      fileName,
      question,
      promptConfig,
    });

    // On envoie à l'assistant
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: userContent,
    });

    // =========================
    // RUN – signature SDK 6.9.0
    // =========================
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    let runStatus = run;

    // =========================
    // POLLING – signature SDK 6.9.0
    // =========================
    while (
      runStatus.status === "queued" ||
      runStatus.status === "in_progress"
    ) {
      await new Promise((r) => setTimeout(r, 400));

      runStatus = await client.beta.threads.runs.retrieve(run.id, {
        thread_id: threadId,
      });
    }

    if (runStatus.status !== "completed") {
      throw new Error("Run non terminé : " + runStatus.status);
    }

    // =========================
    // Récupération de la réponse
    // =========================
    const msgs = await client.beta.threads.messages.list(threadId);

    const assistantReply = msgs.data
      .filter((m) => m.role === "assistant")
      .map((m) => m.content?.[0]?.text?.value || "")
      .join("\n")
      .trim();

    // Liens d'aide en fonction du rapport + langue
    const helpLinks = buildHelpLinks(report, userLang);

    runLocks[workflowSessionId] = false;

    return res.json({
      reply: assistantReply || "Réponse vide",
      threadId,
      workflowSessionId,
      report,
      helpLinks,
    });
  } catch (err) {
    console.error("🔥 ERREUR /pdf2press-chat :", err);
    runLocks[workflowSessionId] = false;

    return res.status(500).json({ error: err.message });
  }
});

// =====================================================
// DÉMARRAGE SERVEUR
// =====================================================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API PDF2Press Chat en cours sur http://localhost:${port}`);
});
