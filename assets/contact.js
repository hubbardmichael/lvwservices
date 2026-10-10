(() => {
  const form = document.getElementById('inquiry');
  const status = document.getElementById('form-status');
  const submit = document.getElementById('send-inquiry');
  const retry = document.getElementById('retry-form');
  let widget, token = '', sending = false, sent = false;
  let requestId = crypto.randomUUID();
  function message(text, error = false, focus = false) {
    status.textContent = text;
    status.dataset.state = error ? 'error' : 'info';
    if (focus) status.focus();
  }
  function clearToken() { token = ''; submit.disabled = true; }
  async function prepare() {
    retry.hidden = true; clearToken();
    message('Preparing the contact form…');
    try {
      const response = await fetch('/api/contact', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      const { siteKey } = await response.json();
      if (!siteKey) throw Error();
      if (!window.turnstile) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        const timer = setTimeout(() => { script.remove(); reject(Error()); }, 12000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error()); };
        document.head.appendChild(script);
      });
      if (widget !== undefined) window.turnstile.remove(widget);
      widget = window.turnstile.render('#spam-check', {
        sitekey: siteKey, action: 'contact', size: 'flexible',
        callback: value => { token = value; if (!sending && !sent) { submit.disabled = false; if (status.dataset.state !== 'error') message('Ready when you are.'); } },
        'expired-callback': () => { clearToken(); if (!sending && !sent) message('The spam check expired. Please complete it again.', true); },
        'error-callback': () => { clearToken(); if (!sending && !sent) { message('The spam check could not load. Please try again.', true); retry.hidden = false; } }
      });
    } catch { message('The contact form is temporarily unavailable. Your message stays on this page; please try again later.', true); retry.hidden = false; }
  }
  form.addEventListener('input', event => {
    const name = event.target.name;
    if (!['name', 'email', 'company', 'needs'].includes(name)) return;
    event.target.removeAttribute('aria-invalid');
    document.getElementById(`${name}-error`).textContent = '';
  });
  retry.addEventListener('click', prepare);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || sent) return;
    let firstInvalid;
    for (const name of ['name', 'email', 'company', 'needs']) {
      const field = form.elements[name];
      field.value = field.value.trim();
      let error = field.validationMessage;
      if (name === 'needs' && field.value.length < 20) error = 'Describe your project in at least 20 characters.';
      field.setAttribute('aria-invalid', String(Boolean(error)));
      document.getElementById(`${name}-error`).textContent = error;
      if (error && !firstInvalid) firstInvalid = field;
    }
    if (firstInvalid) { message('Please check the highlighted fields.', true); firstInvalid.focus(); return; }
    if (!token) { message('Please complete the spam check before sending.', true, true); return; }
    sending = true; submit.disabled = true; submit.textContent = 'Sending…'; form.setAttribute('aria-busy', 'true');
    for (const field of form.querySelectorAll('input, textarea')) field.readOnly = true;
    const body = Object.fromEntries(new FormData(form));
    Object.assign(body, { token, requestId });
    let responseData;
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(22000)
      });
      responseData = await response.json();
      if (!response.ok) {
        for (const [name, error] of Object.entries(responseData.errors || {})) {
          if (!['name', 'email', 'company', 'needs'].includes(name)) continue;
          form.elements[name].setAttribute('aria-invalid', 'true');
          document.getElementById(`${name}-error`).textContent = error;
        }
        throw Error(responseData.message || 'Unable to confirm your submission. Please try again.');
      }
      sent = true; form.reset(); submit.textContent = 'Inquiry submitted';
      window.turnstile.remove(widget); retry.hidden = true;
      message('Thank you. Your inquiry has been submitted to Michael. He will review it personally.', false, true);
    } catch (error) {
      clearToken(); window.turnstile.reset(widget);
      message(responseData?.message || 'We could not confirm your inquiry was sent. Your message is still here; please try again.', true, true);
      submit.textContent = 'Send inquiry';
    } finally {
      sending = false; form.removeAttribute('aria-busy');
      for (const field of form.querySelectorAll('input, textarea')) field.readOnly = sent;
      submit.disabled = sent || !token;
    }
  });
  prepare();
})();
