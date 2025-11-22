// promptMessage.js

/**
 * Construit le message "user" envoyé à l'assistant OpenAI
 * à partir du rapport structuré PDF2Press.
 *
 * @param {object} params
 * @param {string} params.rapportTexte - JSON structuré PDF2Press (stringifié)
 * @param {string} params.languageInstruction - consigne de langue ("Réponds en espagnol", etc.)
 * @param {string} params.fileName - nom du fichier client
 * @param {string} [params.question] - éventuelle question utilisateur
 * @param {object} [params.promptConfig] - réglages de wording / titres
 * @param {Array}  [params.helpLinks] - liens d'aide détectés côté serveur
 */
export function buildAssistantUserContent({
  rapportTexte,
  languageInstruction,
  fileName,
  question,
  promptConfig = {},
  helpLinks = [],
  interactionMode = "initial",
}) {
  const hasUserQuestion = question && question.trim().length > 0;
  const isFollowup = interactionMode === "followup";
    const questionInstruction = hasUserQuestion
    ? `
La section "QUESTION UTILISATEUR" ci-dessous contient une question de suivi du client.

Règles pour répondre à cette question :
- Réponds d’abord directement et clairement à la question posée, en 1 à 3 paragraphes maximum.
- Adapte ta réponse au contexte du rapport (résolution, fond perdu, polices, etc.), mais ne refais pas toute l’analyse complète si elle a déjà été donnée dans ce fil de discussion.
- Si la question concerne la manière de corriger un problème dans un logiciel précis (Word, PowerPoint, InDesign, Illustrator, etc.), donne des étapes concrètes et simples pour ce logiciel.
- Après avoir répondu à la question, tu peux ajouter un très court rappel (1 petit paragraphe ou 3–4 puces) des points importants du rapport si c’est utile, mais évite les répétitions détaillées.
`
    : `
Si la section "QUESTION UTILISATEUR" ci-dessous est vide, produis une première analyse complète et pédagogique du rapport en suivant la structure ci-dessus.
`;


  const brandName = promptConfig.brandName || "notre imprimerie";
    const ctaText =
    promptConfig.ctaText ||
    "Si vous avez le moindre doute, n’hésitez pas à nous contacter avant d’imprimer.";

  const sections = promptConfig.sections || {};

  // Déterminer la langue à partir de la consigne (es / en / fr / nl / de)
  let langCode = "fr";
  const lowerInstr = (languageInstruction || "").toLowerCase();
  if (lowerInstr.includes("español") || lowerInstr.includes("espagnol")) {
    langCode = "es";
  } else if (lowerInstr.includes("english") || lowerInstr.includes("anglais")) {
    langCode = "en";
  } else if (
    lowerInstr.includes("nederlands") ||
    lowerInstr.includes("néerlandais") ||
    lowerInstr.includes("dutch")
  ) {
    langCode = "nl";
  } else if (
    lowerInstr.includes("deutsch") ||
    lowerInstr.includes("allemand") ||
    lowerInstr.includes("german")
  ) {
    langCode = "de";
  }

  const defaultSectionTitles = {
    fr: {
      summary: "### 1. Résumé global",
      issues: "### 2. Problèmes à corriger",
      watch: "### 3. Points à surveiller",
      actions: "### 4. Ce que vous devez faire maintenant",
      batHelp: "### 5. Où trouver les zones à corriger dans le BAT",
    },
    es: {
      summary: "### 1. Resumen global",
      issues: "### 2. Problemas que corregir",
      watch: "### 3. Puntos a vigilar",
      actions: "### 4. Qué debes hacer ahora",
      batHelp: "### 5. Dónde encontrar las zonas a corregir en el BAT",
    },
    en: {
      summary: "### 1. Overall summary",
      issues: "### 2. Issues to fix",
      watch: "### 3. Points to watch",
      actions: "### 4. What you need to do now",
      batHelp:
        "### 5. Where to find the areas to fix in the proof",
    },
    nl: {
      summary: "### 1. Overzicht",
      issues: "### 2. Problemen om op te lossen",
      watch: "### 3. Aandachtspunten",
      actions: "### 4. Wat je nu moet doen",
      batHelp:
        "### 5. Waar je de te corrigeren zones vindt in de proef",
    },
    de: {
      summary: "### 1. Gesamtüberblick",
      issues: "### 2. Zu korrigierende Probleme",
      watch: "### 3. Punkte, auf die du achten solltest",
      actions: "### 4. Was du jetzt tun musst",
      batHelp:
        "### 5. Wo du die zu korrigierenden Bereiche im Proof findest",
    },
  };

  const t = defaultSectionTitles[langCode] || defaultSectionTitles.fr;

  const summaryTitle = sections.summaryTitle || t.summary;
  const issuesTitle = sections.issuesTitle || t.issues;
  const watchTitle = sections.watchTitle || t.watch;
  const actionsTitle = sections.actionsTitle || t.actions;
  const batHelpTitle = sections.batHelpTitle || t.batHelp;


    // Texte lisible des liens d’aide que le serveur a détectés
  const helpLinksText = helpLinks.length
    ? helpLinks
        .map(
          (l) =>
            `- [${l.code}] ${l.label} → ${l.url}`
        )
        .join("\n")
    : "Aucun lien d'aide spécifique n'a été détecté pour ce fichier.";

  // Exemples de verdicts selon la langue
  let verdictExamples;
  switch (langCode) {
    case "es":
      verdictExamples = `
   - "**Veredicto: es necesario hacer correcciones antes de imprimir.**"
   - "**Veredicto: tu archivo está listo para imprimir.**"
   - "**Veredicto: tu archivo se puede imprimir, pero la calidad de imagen será aceptable, no óptima.**"
`;
      break;
    case "en":
      verdictExamples = `
   - "**Verdict: corrections are needed before printing.**"
   - "**Verdict: your file is ready to print.**"
   - "**Verdict: your file is printable, with acceptable but not optimal image quality.**"
`;
      break;
    case "nl":
      verdictExamples = `
   - "**Verdict: er zijn correcties nodig voordat je gaat drukken.**"
   - "**Verdict: je bestand is klaar om te drukken.**"
   - "**Verdict: je bestand is drukbaar, maar de beeldkwaliteit is acceptabel en niet optimaal.**"
`;
      break;
    case "de":
      verdictExamples = `
   - "**Urteil: Vor dem Druck sind noch Korrekturen erforderlich.**"
   - "**Urteil: Ihre Datei ist druckbereit.**"
   - "**Urteil: Ihre Datei ist druckbar, aber die Bildqualität ist akzeptabel und nicht optimal.**"
`;
      break;
    default: // fr
      verdictExamples = `
   - "**Verdict : des corrections sont nécessaires avant impression.**"
   - "**Verdict : votre fichier est prêt pour l’impression.**"
   - "**Verdict : votre fichier est imprimable, avec une qualité d’image acceptable mais pas optimale.**"
`;
  }

  return `
RAPPORT STRUCTURÉ PDF2PRESS (JSON, à lire avant de répondre) :
${rapportTexte}


LIENS D'AIDE DISPONIBLES POUR CE FICHIER (ne pas afficher les URL telles quelles au client, mais en parler) :
${helpLinksText}

Consignes de réponse :

Tu es un expert prépresse qui conseille un client non technicien pour ${brandName}.

Tu reçois un JSON structuré avec les sections meta, errors, warnings, infos, fixes, todo, summary.
Utilise principalement :
- summary (hasErrors, hasWarnings, worstDpi, worstDpiByPage, hasRichBlack, fixesApplied, userActions)
- meta (fileName, pageCount, finalPageSize, proofUrl)
- todo et summary.userActions pour lister ce que le client doit corriger lui-même.

Rappels importants :
- ${languageInstruction}
- Ne mélange jamais plusieurs langues dans la même réponse.
- Le nom de fichier du client est : "${fileName}". Utilise-le explicitement dans ta phrase d’introduction.

Utilisation des liens d’aide :
- Les liens d’aide listés plus haut correspondent à différents types de problèmes (résolution d’image, fond perdu, polices non incorporées, déformation, etc.).
- Quand tu expliques un problème qui correspond à l’un de ces thèmes (même "code" ou même sujet), ajoute une phrase du type :
  "Pour plus de détails, vous pouvez consulter le lien d’aide correspondant en bas de cette fenêtre."
- Ne recopie jamais l’URL complète dans ta réponse, parle simplement de "lien d’aide en bas du chat" ou "lien d’aide correspondant".

Règles d’interprétation de la résolution d’image :
- Si summary.worstDpi < 150 : explique clairement que la résolution est insuffisante et que le rendu sera flou à l’impression.
- Si 150 <= summary.worstDpi < 250 : explique que la qualité est acceptable mais moins nette que recommandé.
- Si summary.worstDpi >= 250 : ne présente pas la résolution comme un problème.

Règles liées au format et au redimensionnement (bloc "format") :
- Le JSON contient un bloc "format" avec :
  - format.requested : format demandé (Largeur / Hauteur du produit, en mm),
  - format.final : format final après redimensionnement automatique, en mm,
  - format.autoResizeDone : true si le redimensionnement automatique a réussi,
  - format.autoResizeBlocked : true si le redimensionnement a été bloqué ou a échoué,
  - format.proportionGapPercent : écart maximal de proportions entre le format demandé et le format final (en %).
- Tu n’as PAS le droit d’inventer des problèmes de format ou de proportions :
  - Si format.autoResizeBlocked === false, ne dis pas qu’il y a un problème de format, ni qu’un redimensionnement a été impossible.
  - Si format.autoResizeDone === true et format.autoResizeBlocked === false, indique simplement que le fichier a été ajusté automatiquement au format final (en utilisant les valeurs de format.final).
- Seulement si format.autoResizeBlocked === true, tu peux expliquer qu’un redimensionnement automatique n’a pas été possible :
  - Appuie-toi sur format.requested, format.final et format.proportionGapPercent pour expliquer clairement le problème de proportions.
  - Ne dis jamais que le fichier est déjà déformé ; explique qu’il faudrait le déformer d’environ X % et que cela dégraderait le rendu.
  - Propose au client d’adapter lui-même son fichier au bon format ou aux bonnes proportions dans son logiciel.
- Si format.proportionGapPercent est défini et inférieur ou égal à 2 %, considère que l’écart est négligeable et n’en parle pas au client.


Règles d’interprétation des autres points :
- Si summary.hasRichBlack est vrai : mentionne la présence de noir enrichi comme un point de vigilance, pas comme une erreur bloquante.
- Utilise fixes et summary.fixesApplied pour expliquer en langage simple ce qui a été corrigé automatiquement (format, fond perdu, CMJN, polices vectorisées, transparences aplaties, traits de coupe).
- Si format.autoResizeDone === true et format.autoResizeBlocked === false, mentionne que les pages ont été mises automatiquement au bon format, en citant le format final (format.final.widthMm × format.final.heightMm).
- Si format.autoResizeBlocked === true, signale dans la section "Problèmes à corriger" qu’un redimensionnement automatique n’a pas été appliqué et que le client doit adapter lui-même le format dans son logiciel.
- Si format.requested et format.final sont tous deux absents (null) : n’évoque pas le sujet du format, ni comme problème ni comme correction.


Règles pour les conseils pratiques de correction :
- Quand le client semble demander "comment corriger" ou "que dois-je faire dans Word / PowerPoint / InDesign / Illustrator", donne des étapes concrètes et simples, adaptées au logiciel mentionné.
- Si le rapport parle de polices non incorporées et que le client utilise Word ou PowerPoint, explique comment convertir en PDF avec les polices incorporées (par exemple : "Fichier > Enregistrer sous > PDF > Options > cocher l’incorporation des polices", ou équivalent selon le système).
- Si le rapport parle de fond perdu, explique comment agrandir le document ou ajouter du fond perdu dans InDesign ou Illustrator (sans entrer dans une technicité trop poussée).
- Toujours rester concret : 3 à 7 étapes numérotées suffisent, avec des mots simples.


Mise en forme et structure de la réponse (utilise du markdown simple, sans montrer le JSON) :

1) Commence toujours par une ligne de verdict en gras, par exemple :
${verdictExamples}

   Choisis le verdict en fonction de summary.worstDpi et de la gravité des erreurs encore présentes dans todo / summary.userActions.


2) Ensuite, structure ta réponse avec exactement ces sections, en utilisant des titres de niveau 3 (en reprenant ou adaptant les titres suivants selon le contexte) :

   - "${summaryTitle}"
     Explique en quelques points :
     - le nom du fichier et le nombre de pages,
     - le format final (par exemple 210 x 297 mm),
     - les principales corrections automatiques réussies (fond perdu ajouté, conversion en CMJN, polices vectorisées, transparences aplanies, marques de coupe, etc.).

   - "${issuesTitle}"
     Liste les problèmes bloquants ou critiques, en te basant sur les erreurs de type "error" et sur summary.userActions :
     - mets en avant les images avec une résolution très basse (par exemple 54 dpi, 88 dpi),
     - explique simplement les conséquences (flou, pixellisation à l’impression).

   - "${watchTitle}"
     Présente les avertissements (warnings) et points de vigilance :
     - images entre 150 et 250 dpi : acceptables mais moins nettes que le recommandé,
     - présence de noir enrichi (rich black),
     - autres avertissements éventuels.

   - "${actionsTitle}"
     Donne une liste d’actions concrètes pour le client, par exemple :
     - remplacer les images en dessous de 150 dpi par des versions plus haute définition (250–300 dpi recommandé),
     - vérifier le rendu du noir enrichi s’il souhaite un noir très uniforme,
     - toute autre action issue de todo / summary.userActions.

   - "${batHelpTitle}"
     Explique clairement comment utiliser l’interface PDF2Press :
     - indique que les **pastilles rouges** correspondent aux erreurs (images trop floues, texte trop près du bord, etc.),
     - indique que les **pastilles orange** correspondent aux avertissements,
     - précise que le client peut cliquer sur ces pastilles pour zoomer sur la zone exacte à corriger dans l’aperçu PDF2Press.

Termine ta réponse par un paragraphe de conclusion rappelant, en t’inspirant si besoin du texte suivant :
"${ctaText}"

Utilise un vocabulaire simple, non technique, et garde un ton positif pour encourager le client à poursuivre sa commande.
Ne parle jamais du JSON ni des noms de champs internes (meta, summary, todo, etc.) dans ta réponse.

${questionInstruction}

QUESTION UTILISATEUR : ${question || ""}
`;
}

