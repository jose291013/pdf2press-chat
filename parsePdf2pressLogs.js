// parsePdf2pressLogs.js
// Petit module utilitaire pour transformer le JSON brut de PDF2Press
// en résumé structuré : meta, erreurs, avertissements, corrections, etc.

/**
 * Essaie de parser une chaîne JSON, sinon renvoie la valeur d'origine.
 */
function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Normalise un bloc "validations" (string JSON ou tableau) en liste d'objets
 * { message, level, severity, fieldName, type, data, source }.
 */
function extractValidations(rawValidations, source = "") {
  if (!rawValidations) return [];

  let arr = null;

  if (Array.isArray(rawValidations)) {
    arr = rawValidations;
  } else if (typeof rawValidations === "string") {
    const parsed = parseMaybeJson(rawValidations);
    if (Array.isArray(parsed)) arr = parsed;
  }

  if (!Array.isArray(arr)) return [];

  return arr
    .map((v) => {
      if (!v) return null;
      const message = v.Message ?? v.message ?? "";
      const level = v.Level ?? v.level ?? 0;
      const fieldName = v.FieldName ?? v.fieldName ?? null;
      const type = v.Type ?? v.type ?? null;
      const data = v.Data ?? v.data ?? null;

      let severity = "info";
      if (level >= 2) severity = "error";
      else if (level === 1) severity = "warning";

      return {
        message,
        level,
        severity,
        fieldName,
        type,
        data,
        source,
      };
    })
    .filter(Boolean);
}

/**
 * Ajoute les validations dans le bon tableau selon leur severity.
 */
function pushBySeverity(report, validations) {
  validations.forEach((v) => {
    // Taguer quelques cas fréquents pour plus tard
    const msg = (v.message || "").toLowerCase();

    if (msg.includes("image resolution")) {
      v.tag = "imageResolution";
    } else if (msg.includes("rich black")) {
      v.tag = "richBlack";
    } else if (msg.includes("bleed")) {
      v.tag = "bleed";
    } else if (msg.includes("password")) {
      v.tag = "password";
    } else if (msg.includes("form field")) {
      v.tag = "formField";
    } else if (
      msg.includes("font") ||
      msg.includes("fonts") ||
      msg.includes("police")
    ) {
      // Problème polices : non incorporées, etc.
      v.tag = "fonts";
    }

    if (v.severity === "error") {
      report.errors.push(v);
    } else if (v.severity === "warning") {
      report.warnings.push(v);
    } else {
      report.infos.push(v);
    }
  });
}

/**
 * Essaie d'extraire quelques métadonnées utiles depuis result.pdfInfo et result.runtimeVariables.
 */
function extractMeta(result) {
  const meta = {
    fileName: null,
    pageCount: null,
    trimWidthMm: null,
    trimHeightMm: null,
    allPagesSameDimension: null,
    impression: null,
    originalLink: result.originalLink ?? null,
    finalLink: result.finalLink ?? null,
    status: result.status ?? null,
  };

  if (result.pdfInfo) {
    const pdf = result.pdfInfo;
    meta.fileName = pdf.fileName ?? pdf.FileName ?? meta.fileName;
    meta.pageCount = pdf.pageCount ?? pdf.PageCount ?? meta.pageCount;
  }

  const rv = Array.isArray(result.runtimeVariables)
    ? result.runtimeVariables
    : [];
  for (const item of rv) {
    const key = item.key;
    const value = item.value;
    if (!key) continue;

    if (key === "Largeur") {
      meta.trimWidthMm = Number(value) || meta.trimWidthMm;
    } else if (key === "Hauteur") {
      meta.trimHeightMm = Number(value) || meta.trimHeightMm;
    } else if (key === "Impression") {
      meta.impression = value;
    } else if (key === "FileInfo.FileInfo.PageCount") {
      const n = Number(value);
      if (!Number.isNaN(n)) meta.pageCount = n;
    } else if (key === "FileInfo.FileInfo.AllPagesSameDimension") {
      meta.allPagesSameDimension = value === "True" || value === true;
    }
  }

  return meta;
}

/**
 * Essaie de détecter des "fixes" appliqués : fond perdu, aplatissement des transparences,
 * conversions couleur, normalisation rich black, outlines de polices, redimensionnement de pages, etc.
 */
function extractFixesFromWorkflowLogs(result) {
  const fixes = [];

  const workflowLogs = Array.isArray(result.workflowLogs)
    ? result.workflowLogs
    : [];
  for (const wf of workflowLogs) {
    const wfName = wf.name || "";
    const wfType = wf.type;
    const isFixWorkflow = wfName === "Fix" || wfType === 4;

    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    for (const step of steps) {
      const actions = Array.isArray(step.actions) ? step.actions : [];
      for (const action of actions) {
        const name = action.name || "";
        const aResults = parseMaybeJson(action.results);

        // On sérialise les validations quel que soit le format pour pouvoir chercher "Atomyx_fixups", "Success", etc.
        const rawValidations = action.validations;
        let aValidations = "";
        if (typeof rawValidations === "string") {
          aValidations = rawValidations;
        } else if (Array.isArray(rawValidations)) {
          try {
            aValidations = JSON.stringify(rawValidations);
          } catch {
            aValidations = "";
          }
        }

        // -------------------------
        // 1) Redimensionnement de pages (Page resize)
        // -------------------------
        if (aResults && Array.isArray(aResults.Pages) && aResults.Pages.length) {
          const firstPage = aResults.Pages[0];
          const hasTrimInfo =
            (firstPage.OriginalTrimBox || firstPage.OriginalMediaBox) &&
            (firstPage.NewTrimBox || firstPage.NewMediaBox);

          if (hasTrimInfo) {
            const newW = aResults.NewWidth ?? null;
            const newH = aResults.NewHeight ?? null;
            let label = "Pages redimensionnées automatiquement.";
            if (newW != null && newH != null) {
              label = `Pages redimensionnées automatiquement au format ${newW} x ${newH}.`;
            }

            fixes.push({
              code: "pageResize",
              label,
              success: aResults.Success === true,
              raw: { wfName, name, aResults },
            });
          }
        }

        // -------------------------
        // 2) Ajout de fond perdu (BleedPageInfo)
        // -------------------------
        if (aResults && Array.isArray(aResults.BleedPageInfo)) {
          const pages = aResults.BleedPageInfo.filter(
            (p) => p.Success && p.BleedAdded
          );
          if (pages.length) {
            const bleedSize =
              (action.args && action.args.BleedSize) ??
              aResults.BleedSizeAdded ??
              null;

            fixes.push({
              code: "bleedAdded",
              label: `Fond perdu ajouté automatiquement${
                bleedSize ? ` (${bleedSize} mm)` : ""
              }.`,
              success: true,
              pages: pages.map((p) => p.Page),
              raw: { wfName, name, aResults },
            });
          }
        }

        // -------------------------
        // 3) Aplatissement des transparences
        // -------------------------
        if (
          isFixWorkflow &&
          (name === "FlatteningTransparencies" ||
            name.toLowerCase().includes("flatten"))
        ) {
          const success =
            aValidations.includes('"Success":true') ||
            aValidations.includes('"Status":"completed"');

          fixes.push({
            code: "flattening",
            label: "Transparences aplaties pour sécuriser l'impression.",
            success,
            raw: { wfName, name, aResults, aValidations },
          });
        }

        // -------------------------
        // 4) Correction Rich Black
        // -------------------------
        if (
          isFixWorkflow &&
          (name === "RichBlack" || name.toLowerCase().includes("richblack"))
        ) {
          // Ici PDF2Press ne renvoie pas toujours un indicateur explicite de succès dans les validations,
          // mais si l'action fait partie du workflow Fix et que son status est bon, on considère que c'est OK.
          const success =
            action.status === 3 ||
            aValidations.includes('"Success":true') ||
            aValidations.includes('"Status":"completed"');

          fixes.push({
            code: "richBlackFix",
            label: "Noirs enrichis (rich black) normalisés automatiquement.",
            success,
            raw: { wfName, name, aResults, aValidations },
          });
        }

        // -------------------------
        // 5) Polices converties en tracés (FontsOutline)
        // -------------------------
        if (
          isFixWorkflow &&
          (name === "FontsOutline" ||
            name.toLowerCase().includes("fontoutline"))
        ) {
          const res = aResults || {};
          const success =
            res.Success === true ||
            action.status === 3 ||
            aValidations.includes('"Success":true');

          fixes.push({
            code: "fontsOutlined",
            label:
              "Polices converties en tracés (contours) pour sécuriser l'impression.",
            success,
            raw: { wfName, name, aResults, aValidations },
          });
        }

        // -------------------------
        // 6) Conversions couleur / profils ICC (Atomyx)
        // -------------------------
        if (
          isFixWorkflow &&
          typeof aValidations === "string" &&
          aValidations.includes("Atomyx_fixups")
        ) {
          fixes.push({
            code: "colorConversion",
            label:
              "Conversion couleur automatique effectuée (CMJN standard et gestion des tons directs).",
            success: true,
            raw: { wfName, name, aValidations },
          });
        }
      }
    }
  }

  // Déduplication simple par (code|label)
  const deduped = [];
  const seen = new Set();
  for (const f of fixes) {
    const key = `${f.code}|${f.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  return deduped;
}

/**
 * Calcule les infos de format / redimensionnement à partir du rapport.
 * - requested : format demandé (Largeur / Hauteur Pressero)
 * - final     : format final après resize auto (NewWidth / NewHeight)
 * - autoResizeDone    : true si le resize auto a réussi
 * - autoResizeBlocked : true si le resize a échoué / bloqué (skew, etc.)
 * - proportionGapPercent : écart max en % entre demandé et final
 */
function computeFormatFromReport(report) {
  const meta = report.meta || {};
  const requestedWidth = meta.trimWidthMm || null;
  const requestedHeight = meta.trimHeightMm || null;

  const fixes = Array.isArray(report.fixes) ? report.fixes : [];
  const resizeFix = fixes.find(
    (f) => f && f.code === "pageResize" && f.raw && f.raw.aResults
  );

  const format = {
    requested:
      requestedWidth && requestedHeight
        ? { widthMm: requestedWidth, heightMm: requestedHeight }
        : null,
    final: null,
    autoResizeDone: false,
    autoResizeBlocked: false,
    wouldExceedMaxSkew: false,
    proportionGapPercent: null,
  };

  if (!resizeFix) {
    // Pas de resize détecté => on laisse les valeurs par défaut
    return format;
  }

  const r = resizeFix.raw.aResults || {};
  const finalWidth = r.NewWidth ?? null;
  const finalHeight = r.NewHeight ?? null;

  if (finalWidth != null && finalHeight != null) {
    format.final = { widthMm: finalWidth, heightMm: finalHeight };
  }

  const success = r.Success === true;
  const wouldExceed = r.WouldExceedMaxSkew === true;

  format.autoResizeDone = !!success;
  format.wouldExceedMaxSkew = wouldExceed;
  // "Bloqué" = soit échec explicite, soit skew trop fort
  format.autoResizeBlocked = !success || wouldExceed;

  if (
    requestedWidth &&
    requestedHeight &&
    finalWidth != null &&
    finalHeight != null
  ) {
    const gapW = Math.abs(finalWidth - requestedWidth) / requestedWidth * 100;
    const gapH = Math.abs(finalHeight - requestedHeight) / requestedHeight * 100;
    format.proportionGapPercent = Math.max(gapW, gapH);
  }

  return format;
}

export function parsePdf2pressLogs(rawLogs) {
  const logs = typeof rawLogs === "string" ? JSON.parse(rawLogs) : rawLogs;
  const logsJson =
    typeof rawLogs === "string" ? rawLogs : JSON.stringify(rawLogs || {});
  const result = logs?.result || null;

  const report = {
    meta: {},
    errors: [],
    warnings: [],
    infos: [],
    fixes: [],
    stats: {
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      fixesCount: 0,
    },
  };

  if (!result) {
    return report;
  }

  // META
  report.meta = extractMeta(result);

  // 🔹 Fallback 1 : utiliser le titre PDF si pas de fileName
  if (!report.meta.fileName && result.pdfInfo && result.pdfInfo.title) {
    report.meta.fileName = result.pdfInfo.title;
  }

  // 🔹 Fallback 2 : chercher "FileName": "xxx.pdf" dans tout le JSON
  if (!report.meta.fileName && logsJson) {
    const m = logsJson.match(
      /"FileName"\s*:\s*"([^"]+\.(?:pdf|eps|ps|ai|indd))"/i
    );
    if (m && m[1]) {
      report.meta.fileName = m[1];
    }
  }

  // 1) Validations globales (si présentes)
  if (result.results?.validations) {
    const vals = extractValidations(result.results.validations, "Global");
    pushBySeverity(report, vals);
  }

  // 2) Parcours des workflowLogs -> steps -> actions
  const workflowLogs = Array.isArray(result.workflowLogs)
    ? result.workflowLogs
    : [];

  for (const wf of workflowLogs) {
    const wfName = wf.name || "";
    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    for (const step of steps) {
      const actions = Array.isArray(step.actions) ? step.actions : [];
      for (const action of actions) {
        const actionName = action.name || "";
        const source = `${wfName || "Workflow"} › ${actionName || "Action"}`;
        const vals = extractValidations(action.validations, source);
        pushBySeverity(report, vals);
      }
    }
  }

    // 3) Fixes appliqués (fond perdu, flattening, couleurs, polices, rich black, resize…)
  report.fixes = extractFixesFromWorkflowLogs(result);

  // 4) Infos de format / redimensionnement
  report.format = computeFormatFromReport(report);

  // 5) Stats
  report.stats.errorCount = report.errors.length;
  report.stats.warningCount = report.warnings.length;
  report.stats.infoCount = report.infos.length;
  report.stats.fixesCount = report.fixes.length;

  return report;
}



/**
 * Optionnel : formatage texte "prêt à envoyer à l'assistant" ou au client.
 * (Tu peux l'utiliser pour injecter un contexte propre dans OpenAI.)
 */
export function formatPdf2pressReportForAssistant(report) {
  const { meta, stats, errors, warnings, fixes } = report;

  let out = "";

  // En-tête
  if (meta.fileName) out += `Fichier : ${meta.fileName}\n`;
  if (meta.pageCount != null) out += `Nombre de pages : ${meta.pageCount}\n`;
  if (meta.trimWidthMm && meta.trimHeightMm) {
    out += `Format final (Trimbox) : ${meta.trimWidthMm} x ${meta.trimHeightMm} mm\n`;
  }
  if (meta.impression) {
    out += `Impression prévue : ${meta.impression}\n`;
  }
  out += `\nRésumé technique : ${stats.errorCount} erreur(s), ${stats.warningCount} avertissement(s), ${stats.fixesCount} correction(s) automatique(s) détectée(s).\n`;

  // Fixes
  out += `\n=== CORRECTIONS AUTOMATIQUES APPLIQUÉES ===\n`;
  if (!fixes.length) {
    out += `Aucune correction automatique détectée dans ce rapport.\n`;
  } else {
    fixes.forEach((f, i) => {
      out += `${i + 1}) ${f.label}\n`;
    });
  }

  // Erreurs
  out += `\n=== ERREURS À EXPLIQUER AU CLIENT (bloquantes ou importantes) ===\n`;
  const errorLines = errors.map((e) => `- ${e.message}`);
  out += errorLines.length
    ? errorLines.join("\n") + "\n"
    : "Aucune erreur bloquante trouvée.\n";

  // Avertissements
  out += `\n=== AVERTISSEMENTS (à mentionner mais rassurer) ===\n`;
  const warnLines = warnings.map((w) => `- ${w.message}`);
  out += warnLines.length
    ? warnLines.join("\n") + "\n"
    : "Aucun avertissement significatif.\n";

  return out;
}



