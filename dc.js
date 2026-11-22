/* Tiny template runtime for charlotteerkau.com.
   Renders the page template (holes {{path}}, <sc-if>, <sc-for>, onX handlers)
   from a component's renderVals(), and patches the live DOM on setState. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      Object.assign(this.state, p || {});
      if (this.__schedule) this.__schedule();
    }
    forceUpdate() { if (this.__schedule) this.__schedule(); }
  }

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    let v = scope[parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function str(v) { return v === null || v === undefined || v === false ? '' : String(v); }

  function interp(text, scope) {
    return text.replace(HOLE, (_, p) => str(lookup(p, scope)));
  }

  function eventName(attr, tag) {
    const n = attr.slice(2).toLowerCase();
    if (n === 'change' && (tag === 'input' || tag === 'textarea')) return 'input';
    if (n === 'doubleclick') return 'dblclick';
    return n;
  }

  function ensureDispatch(el, type) {
    el.__dcBound = el.__dcBound || {};
    if (el.__dcBound[type]) return;
    el.__dcBound[type] = true;
    el.addEventListener(type, (ev) => {
      const h = el.__dcEv && el.__dcEv[type];
      if (typeof h === 'function') h(ev);
    });
  }

  // Only <template> elements hold their children in .content; other elements
  // (newer Chrome gives <canvas> a .content property) use their own child nodes.
  function kids(t) { return t instanceof HTMLTemplateElement ? t.content : t; }
  function renderNodes(tplParent, scope, out) {
    for (const n of tplParent.childNodes) renderNode(n, scope, out);
    return out;
  }

  function renderNode(t, scope, out) {
    if (t.nodeType === 3) { out.push(document.createTextNode(interp(t.data, scope))); return; }
    if (t.nodeType !== 1) return;
    const tag = t.localName;
    if (tag === 'sc-if') {
      const m = WHOLE.exec(t.getAttribute('value') || '');
      const v = m ? lookup(m[1], scope) : false;
      if (v) renderNodes(kids(t), scope, out);
      return;
    }
    if (tag === 'sc-for') {
      const m = WHOLE.exec(t.getAttribute('list') || '');
      const list = m ? lookup(m[1], scope) : null;
      const as = t.getAttribute('as') || 'item';
      if (Array.isArray(list)) {
        list.forEach((item, i) => {
          const s = Object.create(scope);
          s[as] = item; s.$index = i;
          renderNodes(t, s, out);
        });
      }
      return;
    }
    const el = t.namespaceURI && t.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(t.namespaceURI, tag)
      : document.createElement(tag);
    for (const a of t.attributes) {
      const name = a.name;
      if (name.startsWith('hint-')) continue;
      const m = WHOLE.exec(a.value);
      if (/^on[a-z]/i.test(name) && name.length > 2 && m) {
        const fn = lookup(m[1], scope);
        const type = eventName(name, tag);
        el.__dcEv = el.__dcEv || {};
        el.__dcEv[type] = fn;
        ensureDispatch(el, type);
        continue;
      }
      let v = m ? lookup(m[1], scope) : interp(a.value, scope);
      if (v === false || v === null || v === undefined) continue;
      if (v === true) v = '';
      el.setAttribute(name, String(v));
    }
    renderNodes(kids(t), scope, []).forEach((c) => el.appendChild(c));
    out.push(el);
  }

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.localName === b.localName);
  }

  function morphChildren(liveParent, fresh) {
    for (let i = 0; i < fresh.length; i++) {
      const live = liveParent.childNodes[i];
      const f = fresh[i];
      if (!live) { liveParent.appendChild(f); continue; }
      if (sameKind(live, f)) morphNode(live, f);
      else liveParent.replaceChild(f, live);
    }
    while (liveParent.childNodes.length > fresh.length) liveParent.removeChild(liveParent.lastChild);
  }

  function morphNode(live, f) {
    if (live.nodeType === 3) { if (live.data !== f.data) live.data = f.data; return; }
    const keep = live.localName === 'canvas' ? { width: 1, height: 1 } : {};
    for (const a of Array.from(live.attributes)) if (!f.hasAttribute(a.name) && !keep[a.name]) live.removeAttribute(a.name);
    for (const a of f.attributes) if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
    live.__dcEv = f.__dcEv;
    if (f.__dcEv) for (const type in f.__dcEv) ensureDispatch(live, type);
    // never rebuild the inside of a canvas or video
    if (live.localName === 'canvas' || live.localName === 'video') return;
    morphChildren(live, Array.from(f.childNodes));
  }

  function mount(Component, props, tplId, hostId) {
    const tpl = document.getElementById(tplId || 'dc-template');
    const host = document.getElementById(hostId || 'dc-root');
    const comp = new Component(props || {});
    comp.state = comp.state || {};
    let queued = false;
    const draw = () => {
      queued = false;
      const vals = comp.renderVals() || {};
      const fresh = renderNodes(tpl.content, vals, []);
      morphChildren(host, fresh);
    };
    comp.__schedule = () => { if (!queued) { queued = true; queueMicrotask(draw); } };
    draw();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    window.addEventListener('pagehide', () => {
      if (typeof comp.componentWillUnmount === 'function') comp.componentWillUnmount();
    });
    return comp;
  }

  window.DCLogic = DCLogic;
  window.DC = { mount };
})();
