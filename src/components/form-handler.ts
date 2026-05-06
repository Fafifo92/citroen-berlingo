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

// ── Feedback modal dispatcher ──────────────────────────────────────────────────
function showFeedback(
  formType: FormType,
  kind: 'success' | 'error',
  message?: string
) {
  window.dispatchEvent(
    new CustomEvent('form:feedback', {
      detail: { kind, formType, message },
    })
  );
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

  // Privacy consent guard — must be checked before anything else
  const consent = form.querySelector<HTMLInputElement>(
    'input[type="checkbox"][data-privacy-checkbox]'
  );
  if (consent && !consent.checked) {
    setButtonState(submitBtn, 'Acepta el tratamiento de datos', '#c0392b', false);
    consent.focus();
    setTimeout(() => setButtonState(submitBtn, originalText, '', false), 2500);
    return;
  }

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
    showFeedback(formType, 'success');
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
  // POST directly to Zapier webhook as JSON — Zapier supports CORS from browsers.
  try {
    if (!navigator.onLine) {
      throw new Error('offline');
    }

    // Use URLSearchParams so fetch sends application/x-www-form-urlencoded
    // automatically — this is a CORS "simple request" (no preflight) that
    // Zapier webhooks accept without CORS headers.
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: new URLSearchParams(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setButtonState(submitBtn, '¡Enviado! ✓', '#3B3938', true);
    showNotification(form, 'success');
    showFeedback(formType, 'success');
    // Reset v2 widget after success
    if (config?.recaptcha?.version === 'v2') {
      const widgetId = window.__recaptchaWidgets?.get(form);
      window.grecaptcha?.reset(widgetId);
    }
    setTimeout(() => {
      form.reset();
      // Also clear privacy consent state for this form
      const cb = form.querySelector<HTMLInputElement>(
        'input[type="checkbox"][data-privacy-checkbox]'
      );
      if (cb) {
        cb.checked = false;
        delete cb.dataset.accepted;
      }
      setButtonState(submitBtn, originalText, '', false);
    }, 3500);
  } catch (err) {
    console.error('[Form] Error:', err);
    const offline = !navigator.onLine || (err as Error)?.message === 'offline';
    const friendly = offline
      ? 'Parece que no tienes conexión a internet. Verifica tu red e intenta nuevamente.'
      : undefined; // let the modal use its default per-form copy
    setButtonState(submitBtn, 'Error — intenta de nuevo', '#c0392b', true);
    showNotification(form, 'error');
    showFeedback(formType, 'error', friendly);
    // Reset v2 widget on error too
    if (config?.recaptcha?.version === 'v2') {
      const widgetId = window.__recaptchaWidgets?.get(form);
      window.grecaptcha?.reset(widgetId);
    }
    setTimeout(() => setButtonState(submitBtn, originalText, '', false), 4000);
  }
}

