/**
 * hv-renderer.js — Shared variable renderer for html-video
 *
 * Inlined automatically by the adapter when a template uses [data-var].
 * Reads window.__HV_VARS__ (injected by core) and updates DOM elements.
 *
 * Usage: add data-var="variable_name" to any element → text auto-replaces.
 *   <h1><span data-var="headline">Default Text</span></h1>
 *
 * This file is auto-inlined by the adapter — no manual <script> tag needed.
 */
(function() {
  'use strict';
  var vars = {};
  try { vars = window.__HV_VARS__ || {}; } catch(e) {}
  if (!Object.keys(vars).length) return;
  var els = document.querySelectorAll('[data-var]');
  for (var i = 0, el; i < els.length; i++) {
    el = els[i];
    var key = el.getAttribute('data-var');
    var val = vars[key];
    if (val && typeof val === 'string') {
    // Convert \n to <br> elements (DOM-safe, no innerHTML).
    // Multi-line titles like "STAKING\nCRYPTO" render on two lines.
    if (val.indexOf('\n') !== -1) {
      el.textContent = ''; // clear
      var parts = val.split('\n');
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) el.appendChild(document.createElement('br'));
        el.appendChild(document.createTextNode(parts[p]));
      }
    } else {
      el.textContent = val;
    }
  }
  }
  if (vars.duration_sec) {
    document.documentElement.style.setProperty('--hv-duration', vars.duration_sec + 's');
  }
})();
