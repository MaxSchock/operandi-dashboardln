// Texts of the sign-in screens in the four languages the dashboard's users read.
// The language comes from the browser (Accept-Language); English when none matches.

export type Lang = "de" | "fr" | "es" | "en";
const LANGS: Lang[] = ["de", "fr", "es", "en"];

/** First supported language in an Accept-Language header, by quality; "en" otherwise. */
export function pickLang(header: string | null | undefined): Lang {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map(p => p.trim()).find(p => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split("-")[0], quality: isNaN(quality) ? 0 : quality, i };
    })
    .filter(x => x.base && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.i - b.i);
  for (const r of ranked) {
    if ((LANGS as string[]).includes(r.base)) return r.base as Lang;
  }
  return "en";
}

export type LoginTexts = {
  magicTitle: string;
  passwordTitle: string;
  resetTitle: string;
  newPasswordTitle: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  newPasswordPlaceholder: string;
  repeatPasswordPlaceholder: string;
  sendMagic: string;
  signIn: string;
  sendReset: string;
  savePassword: string;
  magicSent: string;
  resetSent: string;
  sendAnother: string;
  usePassword: string;
  useMagic: string;
  forgotPassword: string;
  backToSignIn: string;
  passwordsDiffer: string;
  passwordTooShort: string;
  linkExpired: string;
  loading: string;
};

export const LOGIN_TEXTS: Record<Lang, LoginTexts> = {
  en: {
    magicTitle: "Sign in with a magic link",
    passwordTitle: "Sign in with your password",
    resetTitle: "Reset your password",
    newPasswordTitle: "Choose a new password",
    emailPlaceholder: "you@company.com",
    passwordPlaceholder: "Password",
    newPasswordPlaceholder: "New password (at least 8 characters)",
    repeatPasswordPlaceholder: "Repeat the new password",
    sendMagic: "Send me a magic link",
    signIn: "Sign in",
    sendReset: "Send me a reset link",
    savePassword: "Save password",
    magicSent: "Check your inbox. The link expires in 15 minutes.",
    resetSent: "If this address has an account, a link to reset the password is on its way. Check your inbox.",
    sendAnother: "Send another link",
    usePassword: "Sign in with a password instead",
    useMagic: "Sign in with a magic link instead",
    forgotPassword: "Forgot your password?",
    backToSignIn: "Back to sign-in",
    passwordsDiffer: "The two passwords are not the same.",
    passwordTooShort: "The password needs at least 8 characters.",
    linkExpired: "The link has expired or was already used. Ask for a new one.",
    loading: "Loading…",
  },
  de: {
    magicTitle: "Anmelden mit Magic Link",
    passwordTitle: "Anmelden mit Passwort",
    resetTitle: "Passwort zurücksetzen",
    newPasswordTitle: "Neues Passwort festlegen",
    emailPlaceholder: "name@firma.de",
    passwordPlaceholder: "Passwort",
    newPasswordPlaceholder: "Neues Passwort (mindestens 8 Zeichen)",
    repeatPasswordPlaceholder: "Neues Passwort wiederholen",
    sendMagic: "Magic Link senden",
    signIn: "Anmelden",
    sendReset: "Link zum Zurücksetzen senden",
    savePassword: "Passwort speichern",
    magicSent: "Schau in dein Postfach. Der Link ist 15 Minuten gültig.",
    resetSent: "Wenn es zu dieser Adresse ein Konto gibt, ist der Link zum Zurücksetzen unterwegs. Schau in dein Postfach.",
    sendAnother: "Neuen Link senden",
    usePassword: "Stattdessen mit Passwort anmelden",
    useMagic: "Stattdessen mit Magic Link anmelden",
    forgotPassword: "Passwort vergessen?",
    backToSignIn: "Zurück zur Anmeldung",
    passwordsDiffer: "Die beiden Passwörter stimmen nicht überein.",
    passwordTooShort: "Das Passwort braucht mindestens 8 Zeichen.",
    linkExpired: "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.",
    loading: "Wird geladen…",
  },
  fr: {
    magicTitle: "Connexion par lien magique",
    passwordTitle: "Connexion avec mot de passe",
    resetTitle: "Réinitialiser le mot de passe",
    newPasswordTitle: "Choisir un nouveau mot de passe",
    emailPlaceholder: "vous@entreprise.be",
    passwordPlaceholder: "Mot de passe",
    newPasswordPlaceholder: "Nouveau mot de passe (8 caractères minimum)",
    repeatPasswordPlaceholder: "Répéter le nouveau mot de passe",
    sendMagic: "Recevoir un lien magique",
    signIn: "Se connecter",
    sendReset: "Recevoir un lien de réinitialisation",
    savePassword: "Enregistrer le mot de passe",
    magicSent: "Consultez votre boîte de réception. Le lien est valable 15 minutes.",
    resetSent: "Si un compte existe pour cette adresse, un lien de réinitialisation vous a été envoyé. Consultez votre boîte de réception.",
    sendAnother: "Envoyer un nouveau lien",
    usePassword: "Se connecter plutôt avec un mot de passe",
    useMagic: "Se connecter plutôt avec un lien magique",
    forgotPassword: "Mot de passe oublié ?",
    backToSignIn: "Retour à la connexion",
    passwordsDiffer: "Les deux mots de passe ne sont pas identiques.",
    passwordTooShort: "Le mot de passe doit contenir au moins 8 caractères.",
    linkExpired: "Le lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.",
    loading: "Chargement…",
  },
  es: {
    magicTitle: "Entrar con enlace mágico",
    passwordTitle: "Entrar con contraseña",
    resetTitle: "Restablecer la contraseña",
    newPasswordTitle: "Elige una contraseña nueva",
    emailPlaceholder: "tu@empresa.com",
    passwordPlaceholder: "Contraseña",
    newPasswordPlaceholder: "Contraseña nueva (8 caracteres como mínimo)",
    repeatPasswordPlaceholder: "Repite la contraseña nueva",
    sendMagic: "Enviarme un enlace mágico",
    signIn: "Entrar",
    sendReset: "Enviarme un enlace para restablecerla",
    savePassword: "Guardar contraseña",
    magicSent: "Mira tu bandeja de entrada. El enlace caduca en 15 minutos.",
    resetSent: "Si esta dirección tiene cuenta, te llega un enlace para restablecer la contraseña. Mira tu bandeja de entrada.",
    sendAnother: "Enviar otro enlace",
    usePassword: "Entrar con contraseña",
    useMagic: "Entrar con enlace mágico",
    forgotPassword: "¿Has olvidado la contraseña?",
    backToSignIn: "Volver a entrar",
    passwordsDiffer: "Las dos contraseñas no coinciden.",
    passwordTooShort: "La contraseña necesita al menos 8 caracteres.",
    linkExpired: "El enlace ha caducado o ya se usó. Pide uno nuevo.",
    loading: "Cargando…",
  },
};
