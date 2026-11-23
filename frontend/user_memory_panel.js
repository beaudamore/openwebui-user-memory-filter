// User Memory panel for Open WebUI (repo: openwebui-user-memory-filter, frontend/user_memory_panel.js).
// Adds a "User Memory" section to Settings > Personalization with a Manage button that opens a
// table of the facts the User Memory filter has stored about the signed-in user, with delete per
// fact and delete all. It talks to the installed action function `user_memory_management`
// (action/user_memory_management.py) through Open WebUI's own action route; the action reads and
// deletes through the filter. Served as /static/user-memory-panel.js and loaded by loader.js.
(function () {
  'use strict';

  const ACTION_ID = 'user_memory_management';
  const REQUEST_KEY = 'user_memory_request'; // must match PANEL_REQUEST_KEY in the action
  // Open WebUI only shows the Personalization tab while its own Memories feature is enabled and
  // allowed for the user; without that tab the section goes on the General tab.
  const TAB_ID = 'tab-personalization';
  const FALLBACK_TAB_ID = 'tab-general';
  const SECTION_ID = 'user-memory-panel-section';
  const OVERLAY_ID = 'user-memory-panel-overlay';
  // Class strings copied from Open WebUI's own settings rows and dialog buttons, so the section
  // looks like its neighbours and the classes exist in the compiled stylesheet.
  const CLS = {
    section: 'w-full mt-4',
    title: 'mb-2 text-xs text-gray-600 dark:text-gray-400',
    rows: 'flex flex-col gap-2.5',
    row: 'flex items-center justify-between gap-2.5',
    label: 'min-w-0 text-xs text-gray-600 dark:text-gray-400',
    description: '-mt-1 text-[0.6875rem] text-gray-400 dark:text-gray-600',
    button:
      'flex h-7 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-normal transition ' +
      'bg-gray-100 hover:bg-gray-100/70 text-gray-800 dark:bg-gray-850 dark:hover:bg-gray-850/60 dark:text-white',
  };

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === 'style') Object.assign(node.style, value);
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }

  // ---- Server ----------------------------------------------------------------------------

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') };
  }

  // The action route needs a model id the user may use; a model that lists the action works for
  // every user, any model works for an admin.
  let modelIdPromise = null;
  function modelId() {
    if (!modelIdPromise) {
      modelIdPromise = fetch('/api/models', { headers: authHeaders() })
        .then((res) => {
          if (!res.ok) throw new Error('Could not read your models (HTTP ' + res.status + '). Sign in again.');
          return res.json();
        })
        .then((body) => {
          const models = (body && body.data) || [];
          const withAction = models.find((m) => (m.actions || []).some((a) => a.id === ACTION_ID));
          const model = withAction || models[0];
          if (!model) throw new Error('No model is available to you.');
          return model.id;
        })
        .catch((error) => {
          modelIdPromise = null;
          throw error;
        });
    }
    return modelIdPromise;
  }

  // request: {op: 'list'} or {op: 'delete', facts: [{type, subject}]}. Resolves to {facts, removed}.
  async function ask(request) {
    const res = await fetch('/api/chat/actions/' + ACTION_ID, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ model: await modelId(), chat_id: '', id: '', session_id: '', [REQUEST_KEY]: request }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // The model list may have changed since it was read (action unassigned from that model).
      modelIdPromise = null;
      // The route answers a refusal with its reason in `detail` ("Action not available: ...").
      throw new Error('Memory management is not available: ' + ((body && body.detail) || 'HTTP ' + res.status));
    }
    if (!body || body.error || !Array.isArray(body.facts)) {
      throw new Error((body && body.error) || 'The server gave no answer.');
    }
    return body;
  }

  // ---- Table dialog ----------------------------------------------------------------------

  function colours() {
    const dark = document.documentElement.classList.contains('dark');
    return dark
      ? { bg: '#171717', text: '#e5e5e5', dim: '#a3a3a3', line: '#333', field: '#262626', danger: '#f87171' }
      : { bg: '#ffffff', text: '#171717', dim: '#6b7280', line: '#e5e7eb', field: '#f3f4f6', danger: '#dc2626' };
  }

  function day(iso) {
    const date = new Date(iso);
    return isNaN(date) ? '' : date.toLocaleDateString();
  }

  // Stored types and subjects are snake_case keys.
  function words(key) {
    return String(key || '').replace(/_/g, ' ');
  }

  function openDialog(host) {
    if (document.getElementById(OVERLAY_ID)) return;
    const c = colours();
    let facts = [];
    let busy = false;

    const status = el('div', { style: { fontSize: '12px', color: c.dim, minHeight: '18px' } });
    const count = el('span', { style: { color: c.dim, fontWeight: '400', marginLeft: '8px' } });
    const search = el('input', {
      type: 'search',
      placeholder: 'Search memories',
      'aria-label': 'Search memories',
      style: {
        flex: '1', minWidth: '120px', padding: '6px 10px', borderRadius: '8px', border: '0',
        background: c.field, color: c.text, fontSize: '13px', outline: 'none',
      },
      oninput: () => render(),
    });
    const tableWrap = el('div', { style: { overflow: 'auto', flex: '1', minHeight: '120px' } });

    function button(text, onclick, danger) {
      return el('button', {
        type: 'button',
        text,
        style: {
          padding: '5px 10px', borderRadius: '8px', border: '0', cursor: 'pointer', fontSize: '12px',
          background: c.field, color: danger ? c.danger : c.text, whiteSpace: 'nowrap',
        },
        onclick,
      });
    }

    function setStatus(text, isError) {
      status.textContent = text || '';
      status.style.color = isError ? c.danger : c.dim;
    }

    function cell(tag, text, extra) {
      return el(tag, {
        text,
        style: Object.assign(
          { padding: '6px 8px', textAlign: 'left', verticalAlign: 'top', borderBottom: '1px solid ' + c.line },
          extra || {}
        ),
      });
    }

    function render() {
      const needle = search.value.trim().toLowerCase();
      const shown = facts.filter(
        (f) => !needle || [f.type, f.subject, f.value, f.sentiment].join(' ').toLowerCase().includes(needle)
      );
      count.textContent = shown.length === facts.length ? String(facts.length) : shown.length + ' of ' + facts.length;
      tableWrap.replaceChildren();
      if (!facts.length) {
        tableWrap.appendChild(
          el('div', { text: 'No memories are stored about you.', style: { padding: '24px 8px', color: c.dim, fontSize: '13px' } })
        );
        return;
      }
      const head = el('tr', {}, ['Type', 'Subject', 'Memory', 'Sentiment', 'Confidence', 'First stated', 'Last stated', ''].map(
        (title) => cell('th', title, { position: 'sticky', top: '0', background: c.bg, color: c.dim, fontWeight: '500', whiteSpace: 'nowrap' })
      ));
      const rows = shown.map((f) =>
        el('tr', {}, [
          cell('td', words(f.type), { whiteSpace: 'nowrap' }),
          cell('td', words(f.subject)),
          cell('td', String(f.value || ''), { minWidth: '220px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }),
          cell('td', f.sentiment || ''),
          cell('td', f.confidence == null ? '' : String(f.confidence)),
          cell('td', day(f.first_mentioned), { whiteSpace: 'nowrap' }),
          cell('td', day(f.last_updated), { whiteSpace: 'nowrap' }),
          el('td', { style: { padding: '6px 8px', borderBottom: '1px solid ' + c.line } }, [
            button('Delete', () => remove([f], 'Delete this memory?\n\n' + f.subject + ': ' + f.value), true),
          ]),
        ])
      );
      tableWrap.appendChild(
        el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: c.text } }, [
          el('thead', {}, [head]),
          el('tbody', {}, rows),
        ])
      );
    }

    async function run(request, doneText) {
      if (busy) return;
      busy = true;
      setStatus('Working...');
      try {
        const answer = await ask(request);
        facts = answer.facts
          .slice()
          .sort((a, b) => a.type.localeCompare(b.type) || a.subject.localeCompare(b.subject));
        setStatus(doneText ? doneText(answer) : '');
        render();
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        busy = false;
      }
    }

    function remove(targets, question) {
      if (!targets.length) return;
      if (busy) {
        setStatus('Still working. Try again in a moment.');
        return;
      }
      if (!window.confirm(question + '\n\nThis cannot be undone.')) return;
      run(
        { op: 'delete', facts: targets.map((f) => ({ type: f.type, subject: f.subject })) },
        (answer) => 'Deleted ' + answer.removed + (answer.removed === 1 ? ' memory.' : ' memories.')
      );
    }

    function close() {
      overlay.remove();
    }

    const box = el(
      'div',
      {
        role: 'dialog',
        'aria-label': 'Your memories',
        style: {
          background: c.bg, color: c.text, borderRadius: '16px', padding: '16px', width: 'min(64rem, 96vw)',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: '10px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.35)', border: '1px solid ' + c.line,
        },
      },
      [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
          el('div', { style: { fontSize: '14px', fontWeight: '600' } }, [document.createTextNode('Your memories'), count]),
          search,
          button('Delete all', () => remove(facts, 'Delete all ' + facts.length + ' memories?'), true),
          button('Close', close),
        ]),
        tableWrap,
        status,
      ]
    );

    const overlay = el(
      'div',
      {
        id: OVERLAY_ID,
        style: {
          position: 'fixed', inset: '0', zIndex: '100000', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(0,0,0,0.5)',
        },
        // Keep clicks and keys from reaching the Settings dialog underneath, which closes on both.
        onmousedown: (event) => {
          event.stopPropagation();
          if (event.target === overlay) close();
        },
        onclick: (event) => event.stopPropagation(),
        onkeydown: (event) => {
          event.stopPropagation();
          if (event.key === 'Escape') close();
        },
      },
      [box]
    );

    // Inside the Settings dialog, so its focus trap lets the search box and buttons take focus.
    host.appendChild(overlay);
    search.focus();
    run({ op: 'list' });
  }

  // ---- Settings section ------------------------------------------------------------------

  function addSection(tab) {
    const list = tab.querySelector(':scope > div.overflow-y-auto') || tab;
    const section = el('section', { id: SECTION_ID, class: CLS.section }, [
      el('h3', { class: CLS.title, text: 'User Memory' }),
      el('div', { class: CLS.rows }, [
        el('div', { class: CLS.row }, [
          el('div', { class: CLS.label, text: 'Facts remembered about you' }),
          el('div', { class: 'min-w-0' }, [
            el('button', {
              type: 'button',
              class: CLS.button,
              text: 'Manage',
              onclick: () => openDialog(tab.closest('[role="dialog"]') || document.body),
            }),
          ]),
        ]),
        el('p', {
          class: CLS.description,
          text: 'See and delete the facts the assistant has stored about you from your chats.',
        }),
      ]),
    ]);
    list.appendChild(section);
  }

  // The settings tab the section belongs on, when that tab is the one open right now.
  function openTab() {
    const tab = document.getElementById(TAB_ID);
    if (tab) return tab;
    const hasPersonalization = document.querySelector('[aria-controls="' + TAB_ID + '"]');
    return hasPersonalization ? null : document.getElementById(FALLBACK_TAB_ID);
  }

  // Open WebUI builds a settings tab each time it is opened. A fixed interval finds it; a
  // MutationObserver with a debounce never fires during SvelteKit's render storms.
  setInterval(function () {
    const tab = openTab();
    if (tab && !document.getElementById(SECTION_ID)) addSection(tab);
  }, 1000);
})();
