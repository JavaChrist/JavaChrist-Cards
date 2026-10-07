import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = ["confirmation", "reset-password", "magic-link", "invite", "change-email", "password-changed"];
const root = dirname(fileURLToPath(import.meta.url));

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function copyFor(kind, brand) {
  const resetPath = brand.passwordResetPath || "";
  const copies = {
    confirmation: {
      subject: `Confirmez votre adresse email — ${brand.appName}`,
      title: "Confirmez votre adresse email",
      paragraphs: ["Merci d’avoir créé votre compte.", "Confirmez votre adresse email pour terminer votre inscription."],
      buttonLabel: "Confirmer mon adresse",
      buttonHref: "{{ .ConfirmationURL }}",
      secondary: "Si vous n’êtes pas à l’origine de cette inscription, vous pouvez ignorer cet email.",
    },
    "reset-password": {
      subject: `Réinitialisez votre mot de passe — ${brand.appName}`,
      title: "Réinitialisez votre mot de passe",
      paragraphs: ["Nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte."],
      buttonLabel: "Réinitialiser mon mot de passe",
      buttonHref: "{{ .ConfirmationURL }}",
      secondary: "Si vous n’avez pas demandé cette modification, vous pouvez ignorer cet email.",
    },
    "magic-link": {
      subject: `Votre lien de connexion — ${brand.appName}`,
      title: "Connectez-vous à votre compte",
      paragraphs: ["Utilisez le bouton ci-dessous pour ouvrir votre session. Ce lien expire rapidement et ne sert qu’une fois."],
      buttonLabel: "Me connecter",
      buttonHref: "{{ .ConfirmationURL }}",
      secondary: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet email.",
    },
    invite: {
      subject: `Vous êtes invité — ${brand.appName}`,
      title: "Vous êtes invité",
      paragraphs: [`Une invitation vous permet de rejoindre ${brand.appName}.`, "Acceptez l’invitation pour créer votre accès."],
      buttonLabel: "Accepter l’invitation",
      buttonHref: "{{ .ConfirmationURL }}",
      secondary: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet email.",
    },
    "change-email": {
      subject: `Confirmez votre nouvelle adresse email — ${brand.appName}`,
      title: "Confirmez votre nouvelle adresse email",
      paragraphs: ["Une demande de changement d’adresse a été faite pour votre compte.", "Nouvelle adresse : {{ .NewEmail }}"],
      buttonLabel: "Confirmer la nouvelle adresse",
      buttonHref: "{{ .ConfirmationURL }}",
      secondary: "Si vous n’avez pas demandé ce changement, vous pouvez ignorer cet email.",
    },
    "password-changed": {
      subject: `Votre mot de passe a été modifié — ${brand.appName}`,
      title: "Votre mot de passe a été modifié",
      paragraphs: ["Le mot de passe de votre compte vient d’être changé.", "Si vous êtes à l’origine de ce changement, aucune autre action n’est nécessaire."],
      buttonLabel: resetPath ? "Mot de passe oublié" : `Ouvrir ${brand.appName}`,
      buttonHref: `{{ .SiteURL }}${resetPath}`,
      secondary: "Si vous n’avez pas fait cette modification, utilisez le bouton pour en choisir un nouveau, puis contactez le support.",
    },
  };
  return copies[kind];
}

export function renderAuthMail(kind, brand) {
  const copy = copyFor(kind, brand);
  const appName = escapeHtml(brand.appName);
  const accent = escapeHtml(brand.accent || "#ff941f");
  const logo = (brand.logoUrl || "").trim();
  const logoBlock = logo
    ? `<img src="${escapeHtml(logo)}" width="72" height="72" alt="Logo ${appName}" style="display:block;border:0;outline:none;text-decoration:none;width:72px;height:72px;">`
    : `<p style="margin:0;font-size:18px;line-height:24px;font-weight:700;color:#18181b;">JavaChrist</p>`;
  const paragraphs = copy.paragraphs
    .map((paragraph) => `<p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#18181b;">${paragraph.includes("{{") ? paragraph : escapeHtml(paragraph)}</p>`)
    .join("");
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">
            <tr>
              <td bgcolor="${accent}" style="border-radius:999px;">
                <a href="${copy.buttonHref}" style="display:inline-block;padding:14px 22px;font-size:16px;line-height:20px;font-weight:700;color:#121315;text-decoration:none;">${escapeHtml(copy.buttonLabel)}</a>
              </td>
            </tr>
          </table>`;
  const support = (brand.supportEmail || "").trim()
    ? `<p style="margin:8px 0 0;font-size:13px;line-height:20px;color:#71717a;">Support : ${escapeHtml(brand.supportEmail.trim())}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <!-- Sujet : ${escapeHtml(copy.subject)} -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:28px 24px 8px;">
              ${logoBlock}
              <p style="margin:16px 0 0;font-size:18px;line-height:24px;font-weight:700;color:#18181b;">${appName}</p>
              <p style="margin:4px 0 0;font-size:13px;line-height:18px;color:#71717a;">by JavaChrist</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 8px;">
              <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;color:#18181b;">${escapeHtml(copy.title)}</h1>
              ${paragraphs}
              ${button}
              <p style="margin:0;font-size:14px;line-height:22px;color:#71717a;">${escapeHtml(copy.secondary)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px;">
              <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#71717a;">JavaChrist — Applications &amp; automatisations</p>
              ${support}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

const appFlag = process.argv.indexOf("--app");
const appName = appFlag >= 0 ? process.argv[appFlag + 1] : "javachrist-cards";
const brand = JSON.parse(readFileSync(join(root, `${appName}.json`), "utf8"));
if (!brand.accent) brand.accent = "#ff941f";
for (const kind of KINDS) {
  writeFileSync(join(root, `${kind}.html`), renderAuthMail(kind, brand), "utf8");
}
console.log(`Templates écrits pour ${brand.appName}`);
