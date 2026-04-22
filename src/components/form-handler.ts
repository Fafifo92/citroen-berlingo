// form-handler.ts — Shared Zapier + reCAPTCHA (v2 & v3) form submission module
// Import inside <script> tags in Astro components:
//   import { submitForm } from './form-handler';

export type FormType = 'cotizacion' | 'cita' | 'repuestos';

interface SiteConfig {
  zapier: Record<FormType, string>;
  recaptcha: { siteKey: string; version: 'v2' | 'v3' };
}

declare global {
  interface Window {
    __SITE_CONFIG__: SiteConfig;
    __recaptchaWidgets: WeakMap<HTMLFormElement, number>;
    grecaptcha: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
      getResponse: (widgetId?: number) => string;
      reset: (widgetId?: number) => void;
    };
  }
}

// ── reCAPTCHA token ────────────────────────────────────────────────────────────
async function getRecaptchaToken(
  action: string,
  form: HTMLFormElement
): Promise<string | null> {
  const cfg = window.__SITE_CONFIG__?.recaptcha;
  if (!cfg?.siteKey || typeof window.grecaptcha === 'undefined') return null;

  if (cfg.version === 'v2') {
    const widgetId = window.__recaptchaWidgets?.get(form);
    const response = window.grecaptcha.getResponse(widgetId);
    return response || null;
  }

  // v3 — invisible, returns a score
  return new Promise((resolve) => {
    window.grecaptcha.ready(() => {
      window.grecaptcha
        .execute(cfg.siteKey, { action })
        .then(resolve)
        .catch(() => resolve(null));
    });
  });
}

// ── Button state helper ────────────────────────────────────────────────────────
function setButtonState(btn: HTMLButtonElement, text: string, bg?: string, disabled = true) {
  btn.textContent = text;
  btn.disabled = disabled;
  if (bg !== undefined) btn.style.backgroundColor = bg;
}

// ── Inline notification ────────────────────────────────────────────────────────
function showNotification(form: HTMLFormElement, type: 'success' | 'error') {
  form.querySelector('.form-notification')?.remove();

  const el = document.createElement('p');
  el.className = 'form-notification';
  const isOk = type === 'success';
  el.style.cssText = [
    'margin-top:12px',
    'padding:10px 14px',
    'border-radius:4px',
    'font-size:13px',
    'font-weight:700',
    'text-align:center',
    'letter-spacing:0.03em',
    `background:${isOk ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.15)'}`,
    `color:${isOk ? '#27ae60' : '#e74c3c'}`,
    `border:1px solid ${isOk ? 'rgba(39,174,96,0.3)' : 'rgba(231,76,60,0.3)'}`,
  ].join(';');
  el.textContent = isOk
    ? 'Un asesor te contactará muy pronto. ¡Gracias!'
    : 'Ocurrió un error. Por favor intenta de nuevo.';

  form.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function submitForm(
  form: HTMLFormElement,
  formType: FormType,
  submitBtn: HTMLButtonElement
): Promise<void> {
  const config = window.__SITE_CONFIG__;
  const webhookUrl = config?.zapier?.[formType] ?? '';

  const originalText = submitBtn.textContent?.trim() ?? 'Enviar';
  setButtonState(submitBtn, 'Enviando…', undefined, true);

  // Collect form fields
  const data: Record<string, string> = { tipo: formType };
  new FormData(form).forEach((val, key) => {
    data[key] = val.toString().trim();
  });
  data.timestamp = new Date().toISOString();
  data.page_url = window.location.href;

  // reCAPTCHA token
  const token = await getRecaptchaToken(formType, form);
  if (token) {
    data.recaptcha_token = token;
  } else if (config?.recaptcha?.version === 'v2' && config?.recaptcha?.siteKey) {
    // v2 requires the user to solve the challenge before submitting
    setButtonState(submitBtn, 'Completa el captcha primero', '#c0392b', false);
    setTimeout(() => setButtonState(submitBtn, originalText, '', false), 3000);
    return;
  }

  // ── Dev mode ───────────────────────────────────────────────────────────────
  if (!webhookUrl || webhookUrl.includes('XXXXXXX') || webhookUrl === '') {
    console.info('[Form] Dev mode — webhook not configured. Payload:', data);
    setButtonState(submitBtn, '✓ Enviado (dev)', '#3B3938', true);
    // Reset v2 widget
    if (config?.recaptcha?.version === 'v2') {
      const widgetId = window.__recaptchaWidgets?.get(form);
      window.grecaptcha?.reset(widgetId);
    }
    setTimeout(() => {
      form.reset();
      setButtonState(submitBtn, originalText, '', false);
    }, 3000);
    return;
  }

  // ── Production POST ────────────────────────────────────────────────────────
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setButtonState(submitBtn, '¡Enviado! ✓', '#3B3938', true);
    showNotification(form, 'success');
    // Reset v2 widget after success
    if (config?.recaptcha?.version === 'v2') {
      const widgetId = window.__recaptchaWidgets?.get(form);
      window.grecaptcha?.reset(widgetId);
    }
    setTimeout(() => {
      form.reset();
      setButtonState(submitBtn, originalText, '', false);
    }, 4000);
  } catch (err) {
    console.error('[Form] Error:', err);
    setButtonState(submitBtn, 'Error — intenta de nuevo', '#c0392b', true);
    showNotification(form, 'error');
    // Reset v2 widget on error too
    if (config?.recaptcha?.version === 'v2') {
      const widgetId = window.__recaptchaWidgets?.get(form);
      window.grecaptcha?.reset(widgetId);
    }
    setTimeout(() => setButtonState(submitBtn, originalText, '', false), 4000);
  }
}

