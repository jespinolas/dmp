
    // --- Global diagnostics: show full error and where it came from ---
(function setupDiagnostics(){
  function toast(title, lines){
    try {
      const box = document.createElement('div');
      box.className = 'alert alert-danger position-fixed top-0 end-0 m-3';
      box.style.zIndex = 5000;
      box.innerHTML = `<strong>${title}</strong><div class="small" style="max-width:520px;white-space:pre-wrap">${lines.filter(Boolean).join('\n')}</div>`;
      document.body.appendChild(box); setTimeout(()=>box.remove(), 10000);
    } catch {}
  }

  // JS exceptions (even ones inside event handlers)
  window.addEventListener('error', (e) => {
    console.error('[window.onerror]', e.message, e.error || '');
    toast('JS Error', [
      e.message || '(no message)',
      e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '',
      e.error && e.error.stack || ''
    ]);
  });

  // Unhandled Promise rejections (async/await, fetch chains, etc.)
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && (e.reason.message || e.reason)) || '(no reason)';
    console.error('[unhandledrejection]', e.reason);
    toast('Promise Rejection', [String(msg), e.reason && e.reason.stack || '']);
  });

  // Optional (debug only): warn when getElementById returns null
  const nativeGetById = document.getElementById.bind(document);
  document.getElementById = function(id){
    const el = nativeGetById(id);
    if (!el) {
      const stack = (new Error()).stack?.split('\n').slice(2,7).join('\n');
      console.warn(`[DOM] getElementById('${id}') -> null\n${stack||''}`);
    }
    return el;
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  const modeSel = document.getElementById('in_lineAngleMode');
  const hid     = document.getElementById('in_lineOrientation');
  function syncOrientationHidden(){
    if (!hid || !modeSel) return;
    hid.value = (modeSel.value === 'presetNS') ? '1' : '0'; // 0=E–W, 1=N–S
  }
  modeSel?.addEventListener('change', syncOrientationHidden);
  syncOrientationHidden(); // set once on load
});

    (() => {
        const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
        const modHeld = (ev) => (isMac ? ev.metaKey : ev.ctrlKey);  // ⌘ on Mac, Ctrl elsewhere
        document.addEventListener('DOMContentLoaded', () => {
          const label = /Mac|iPhone|iPad|iPod/.test(navigator.platform||navigator.userAgent) ? '⌘' : 'Ctrl';
          document.querySelectorAll('.kb-mod').forEach(el => el.textContent = label);
        });

        // 1) Show ⌘ on Macs in the keybinds UI
        document.addEventListener('DOMContentLoaded', () => {
          const label = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
          document.querySelectorAll('.kb-mod').forEach(el => el.textContent = label);
        });

        // 2) Selection modifier state: reset on Meta too, not just Control
        document.addEventListener('keyup', (e) => {
          if (e.key === 'Control' || e.key === 'Meta') CTRL_DOWN = false;
        });
        window.addEventListener('blur', () => { CTRL_DOWN = false; }); // safety

        /* ---------- helpers & config ---------- */
        var Onboard;
        let Clipboard = null;
        let lastMouseLatLng = null;
        let GroupDrag = null;

          document.addEventListener('click', (e) => {
            const veil = e.target.closest('#installerWrap.premium-locked .premium-veil');
            if (veil) {
              e.preventDefault();
              window.location.href = '/Home/Premium'; // adjust if your upgrade route differs
            }
          });

        const Tabs = {
          lastNonDownloadBtnId: 'tab-settings-tab',  // sensible default = Advanced
          activeBtnId() { return document.querySelector('#sideTabs .nav-link.active')?.id || null; },
          isDownload()  { return this.activeBtnId() === 'tab-export-tab'; },
          rememberPrevious(prevId){
            if (prevId && prevId !== 'tab-export-tab') this.lastNonDownloadBtnId = prevId;
          },
          bounceBackIfOnDownload(){
            if (!this.isDownload()) return;
            const id = this.lastNonDownloadBtnId || 'tab-settings-tab';
            document.getElementById(id)?.click();
          }
        };

        // Whenever the Download tab becomes active, remember where we came from
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('#sideTabs [data-bs-toggle="tab"]')
            .forEach(btn => btn.addEventListener('shown.bs.tab', (ev) => {
              const newId  = ev.target?.id;
              const prevId = ev.relatedTarget?.id;   // the tab we came from
              if (newId === 'tab-export-tab') Tabs.rememberPrevious(prevId);
            }));
        });

            /* --- Tab helpers --- */
        function showTabByButtonId(btnId){
          const btn = document.getElementById(btnId);
          if (!btn) return;
          bootstrap.Tab.getOrCreateInstance(btn).show(); // fires shown.bs.tab
        }

        function goToDownloadAfterGeneration(){
          const hasFlags = (storedMap?.flags?.length || 0) > 0;
          if (!hasFlags) return; // nothing generated, don't jump

          const isDownloadActive = document.getElementById('tab-export')?.classList.contains('active');
          if (!isDownloadActive) {
            showTabByButtonId('tab-export-tab'); // will also trigger your tab-memory logic
          }
        }

        /* -------------------------------------------------------
           Single Waypoint Settings mode (for the waypoint tool)
        ------------------------------------------------------- */
        let WAYPOINT_SETTINGS_MODE = false;
        let _advPrevTitle = null;

        /* Bootstrap tab helper (no-op if already defined elsewhere) */
        function showTabByButtonId(btnId){
          const btn = document.getElementById(btnId);
          if (!btn) return;
          bootstrap.Tab.getOrCreateInstance(btn).show();
        }

        /* Enter/exit the focused waypoint-settings mode */
        function setWaypointSettingsMode(on){
          WAYPOINT_SETTINGS_MODE = !!on;

          // 1) Rename the Advanced headline
          const advForm = document.getElementById('mainForm');
          const titleEl = advForm ? advForm.querySelector('h2.h5') : null;
          if (titleEl){
            if (on){
              if (_advPrevTitle === null) _advPrevTitle = titleEl.textContent;
              titleEl.textContent = 'Single Waypoint Settings';
            } else if (_advPrevTitle !== null){
              titleEl.textContent = _advPrevTitle;
            }
          }

          // 2) Hide/Show: Coverage section + "Generate Every Point"
          const coverageItem = document.querySelector('[data-section="coverage"]');
          const genAllGroup  = document.querySelector('[data-name="gen-all"]');
          if (coverageItem) coverageItem.classList.toggle('hide', on);
          if (genAllGroup)  genAllGroup.classList.toggle('hide', on);

          // 3) Override the "shape-lock": enable only fields that were disabled by it
          const adv = document.getElementById('tab-settings');
          if (adv){
            // Remove the veil while in this mode; restore when leaving.
            adv.classList.toggle('shape-locked', !on && !hasAnyShapes());

            adv.querySelectorAll('input, select, textarea, button').forEach(el => {
              // Only touch those we disabled due to "no shape" (marked via data-shapeLock)
              if (on) {
                if (el.dataset.shapeLock === '1') el.disabled = false;
              } else {
                if (el.dataset.shapeLock === '1') el.disabled = true;
              }
            });
          }
        }

            // --- Remember last non-Download tab + tab helpers ---
            let LAST_NON_EXPORT_TAB_BTN_ID = 'tab-presets-tab';  // default

            function showTabByButtonId(btnId){
              const btn = document.getElementById(btnId);
              if (!btn) return;
              bootstrap.Tab.getOrCreateInstance(btn).show();
            }

            function activeSideTabTarget(){
              const el = document.querySelector('#sideTabs .nav-link.active');
              return el?.getAttribute('data-bs-target') || null; // e.g. "#tab-export"
            }

            function maybeJumpBackFromDownloadOnUndo(){
              if (activeSideTabTarget() === '#tab-export'){
                showTabByButtonId(LAST_NON_EXPORT_TAB_BTN_ID);
              }
            }

            // Track the last non-Download tab as you move around
            document.addEventListener('DOMContentLoaded', () => {
              const initBtn = document.querySelector('#sideTabs .nav-link.active');
              const initTarget = initBtn?.getAttribute('data-bs-target');
              if (initBtn && initTarget !== '#tab-export'){
                LAST_NON_EXPORT_TAB_BTN_ID = initBtn.id;
              }

              const sideTabs = document.getElementById('sideTabs');
              sideTabs?.addEventListener('shown.bs.tab', (ev) => {
                const t = ev.target.getAttribute('data-bs-target');
                if (t && t !== '#tab-export'){
                  LAST_NON_EXPORT_TAB_BTN_ID = ev.target.id;
                }
              });
            });

    function setOverlapPercent(v){
      // Clamp + round to int %
      const pct = Math.min(95, Math.max(25, Math.round(Number(v) || 0)));

      // Hidden canonical field (used by server + slider)
      const hid = $id('in_overlap'); if (hid) hid.value = String(pct);

      // Simple tab slider + label
      const sl  = $id('qualitySlider');
      const lbl = $id('qualityValue');
      if (sl && String(sl.value) !== String(pct)) sl.value = String(pct);
      if (lbl) lbl.textContent = String(pct);

      // Recompute spacing + speed
      if (typeof updateOverlap === 'function') updateOverlap();
    }

        const $id = (id) => document.getElementById(id);

        // When the Simple tab slider moves (extend your existing handler)
        const oldApplyPresetFromSlider = (typeof applyPresetFromSlider === 'function') ? applyPresetFromSlider : null;
        window.applyPresetFromSlider = function(){
          const sl = $id('qualitySlider');
          const ov = parseInt(sl?.value || '80', 10);
          // Keep original behavior (label + hidden #in_overlap)
          if (oldApplyPresetFromSlider) oldApplyPresetFromSlider();
          // Also update the Advanced field and recompute spacing
          setOverlapPercent(ov);
        };

        // Recompute speed when interval changes (speed = spacing / interval)
        $id('in_interval')?.addEventListener('input', () => {
          if (typeof updateIntervalOverlap === 'function') updateIntervalOverlap();
        });

        // Initialize Advanced overlap to whatever the hidden field/slider currently has
        document.addEventListener('DOMContentLoaded', () => {
          const start = $id('in_overlap')?.value ?? '80';
          setOverlapPercent(start);
        });

            (function () {
          const el = document.getElementById('in_overlap');
          let lastValid = parseInt(el.value || '80', 10);
          let t;

          function commit() {
            const n = Number(el.value);
            if (!Number.isFinite(n)) { el.value = lastValid; return; }
            const pct = Math.min(95, Math.max(25, Math.round(n)));
            el.value = pct;
            lastValid = pct;
            if (typeof updateOverlap === 'function') updateOverlap();
          }

          el.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(commit, 500); // wait 500ms after last keystroke
          });

          el.addEventListener('blur', commit); // ensure commit if they tab out
        })();

        const M2FT = 3.28084;
            const toMetersLen  = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? (unitMode ? n / M2FT : n) : n;
        };
        const toMetersSpd  = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? (unitMode ? n / M2FT : n) : n;
        };

        // Single canonical serializer for server payloads
        function markerToServerPoint(m){
          return {
            id: m.id,
            Latitude:  m.lat,
            Longitude: m.lng,
            altitude:  toMetersLen(m.altitude),  // <-- meters
            speed:     toMetersSpd(m.speed),     // <-- m/s
            gimbalAngle: m.angle,
            heading:   m.heading,
            action:    m.action,
            turnMode:  m.turnMode,
            // these two are already “DJI meters” in your UI logic; send as-is
            useStraightLine:
              (typeof m.useStraightLine === 'number')
                ? m.useStraightLine
                : ($id('in_straightenLines')?.checked ? 1 : 0),
            waypointTurnDampingDist:
              (typeof m.waypointTurnDampingDist === 'number')
                ? m.waypointTurnDampingDist
                : ($id('in_straightenLines')?.checked ? 0 : 20)
          };
        }
        const IS_PREMIUM = false;
        let initialized = 0, hasGeolocation = 0, storedMap, intervalSeen = false;
        window.activeIWMarker = null;

        /* ---------- async Maps boot ---------- */
        let geoPos = null;
        let geoReady = 0;
        let mapBooted = 0;

        function mapsApiReady(){
            return !!(window.google && google.maps && google.maps.Map && google.maps.places);
        }

        function maybeInitMap() {
            if (mapBooted) return;
            if (!mapsApiReady()) return; // wait until full API is ready
            mapBooted = 1;
            const pos = geoPos || { coords: { latitude: 0, longitude: 0 } };
            bootMap(pos, geoReady);
        }

        ['input','change'].forEach(evt => {
          $id('mainForm')?.addEventListener(evt, refreshGenStaleNote, true);
          $id('qualitySlider')?.addEventListener('input', refreshGenStaleNote);
        });

        let lastGenerateSig = null;

        function getGenerateSignature(){
          const g = {
            unit: $id('in_units')?.value,
            altitude: $id('altitude')?.value,
            speed: $id('speed')?.value,
            angle: $id('angle')?.value,
            distance: $id('in_distance')?.value,
            overlap: $id('in_overlap')?.value,
            interval: $id('in_interval')?.value,
            // line/turning & premium toggles that affect generation
            lineMode: $id('in_lineAngleMode')?.value,
            lineDeg: $id('in_lineAngleDegrees')?.value,
            lineOrient: $id('in_lineOrientation')?.value,
            flipPath: $id('in_flipPath')?.checked,
            maintainAlt: $id('maintainAlt')?.checked,
            straighten: $id('in_straightenLines')?.checked,
            genAll: $id('in_generateAllPoints')?.checked,
            turnMode: $id('in_turnMode')?.value,
            allPointsAction: $id('in_allPointsAction')?.value
          };
          // Stable string for cheap comparisons
          return JSON.stringify(g);
        }

        /* ---------- shape-lock helpers ---------- */
        function attachShapeVeilTo(id){
          const host = document.getElementById(id);
          if (!host) return;
          host.classList.add('shape-lock');
          if (!host.querySelector('.shape-veil')){
            const veil = document.createElement('div');
            veil.className = 'shape-veil';
            veil.innerHTML = `
              <div class="shape-veil-text">
                You need to draw a shape
                <span class="opt-block" data-opt="select">
                  <span class="opt-sep"> or </span><a href="#" data-action="select-all">Select all waypoints</a>
                </span>
                <span class="opt-block" data-opt="undo">
                  <span class="opt-sep"> or </span><a href="#" data-action="undo-shapes">undo</a> your past generation
                </span>
                for changes here to do anything.
              </div>`;
            host.appendChild(veil);
            veil.querySelector('[data-action="undo-shapes"]')?.addEventListener('click', (e) => {
              e.preventDefault();
              undoUntilShapes();
            });
                veil.querySelector('[data-action="select-all"]')?.addEventListener('click', (e) => {
                e.preventDefault();
                const ids = (storedMap?.flags || []).map(m => m.id);
                if (ids.length) applySelectionByIds(ids);
                    veil.querySelector('[data-action="undo-shapes"]')?.addEventListener('click', (e) => {
                      e.preventDefault();
                      undoUntilShapes();
                    });
       });
          }
        }

            function updateShapeVeilLinks(){
              const anyFlags = (storedMap?.flags?.length || 0) > 0;
              const canUndo  = (History?.undoStack?.length || 0) > 0;

              // Select-all only makes sense when there are waypoints
              document.querySelectorAll('.shape-veil [data-opt="select"]')
                .forEach(el => { el.style.display = anyFlags ? '' : 'none'; });

              // Show the "undo" option only if there's something to undo
              document.querySelectorAll('.shape-veil [data-opt="undo"]')
                .forEach(el => { el.style.display = canUndo ? '' : 'none'; });
            }

        function attachDownloadVeil(){
          const host = document.getElementById('downloadWrap');
          if (!host) return;
          // already has veil from markup, just make sure class exists
          host.classList.add('waypoint-lock');
        }
        document.addEventListener('DOMContentLoaded', attachDownloadVeil);

        /* Repeatedly undo until we have shapes back */
        function undoUntilShapes(){
          let guard = 100;
          while (!hasAnyShapes() && History.undoStack.length > 0 && guard-- > 0){
            History.undo();
          }
          // Availability will update via calls added below
        }

        /* Enable/disable inputs we control + toggle veil state */
        function updateAdvancedSettingsAvailability(){
          const locked = !hasAnyShapes() && !WAYPOINT_SETTINGS_MODE; // allow when waypoint tool active

          // Toggle veil ON/OFF (only shows on hover when locked)
          ['tab-settings','sliderBlock'].forEach(id => {
            const host = document.getElementById(id);
            if (host) host.classList.toggle('shape-locked', locked);
          });

          // Disable/enable Advanced controls (without touching Premium disables)
          const adv = document.getElementById('tab-settings');
          if (adv){
            adv.querySelectorAll('input, select, textarea, button').forEach(el => {
              if (locked) {
                if (!el.disabled){ el.disabled = true; el.dataset.shapeLock = '1'; }
              } else {
                if (el.dataset.shapeLock === '1'){ el.disabled = false; delete el.dataset.shapeLock; }
              }
            });
          }

          // Slider (Simple tab)
          const qs = document.getElementById('qualitySlider');
          const block = document.getElementById('sliderBlock');
          if (qs){
            if (locked){
              if (!qs.disabled){ qs.disabled = true; qs.dataset.shapeLock = '1'; }
              block?.classList.add('dimmed');   // we override its pointer-events in CSS
            } else {
              if (qs.dataset.shapeLock === '1'){ qs.disabled = false; delete qs.dataset.shapeLock; }
              // keep your existing enable/disable logic if you want;
              // we just guarantee it turns back on when shapes exist
              block?.classList.remove('dimmed');
            }
          }

              updateShapeVeilLinks();
        }


        document.addEventListener('DOMContentLoaded', () => {
          attachShapeVeilTo('tab-settings'); // Advanced tab content area
          attachShapeVeilTo('sliderBlock');  // Quality slider block
          updateAdvancedSettingsAvailability(); // initial state (likely locked)
              updateShapeVeilLinks();
        });

        function refreshGenStaleNote(){
          const note = $id('genStaleNote');
          if (!note) return;
          const hasPoints = (storedMap?.flags?.length || 0) > 0;
          const dirty = !!lastGenerateSig && (getGenerateSignature() !== lastGenerateSig);
          note.classList.toggle('hide', !(hasPoints && dirty));
        }

        // Initialize baseline when UI is ready
        document.addEventListener('DOMContentLoaded', () => {
          lastGenerateSig = getGenerateSignature();
        });

        function updateEmptyDownloadVeils(){
          const hasFlags = (storedMap?.flags?.length || 0) > 0;

          // Normal Download
          const dVeil = document.querySelector('#downloadWrap .empty-veil');
          if (dVeil) dVeil.style.display = hasFlags ? 'none' : '';

          // Split & ZIP: only show this empty veil for Premium users.
          const sVeil = document.querySelector('#splitZipWrap .empty-veil');
          if (sVeil) sVeil.style.display = (IS_PREMIUM && !hasFlags) ? '' : 'none';
        }

        try {
          if (!("geolocation" in navigator)) {
            geoPos = null; geoReady = 0; maybeInitMap(); // fallback boot
          } else {
            const GEO_OPTS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };

            // Quick one-shot for the first fix (faster perceived center)
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                geoPos = pos; geoReady = 1;
                if (mapBooted) applyGeolocationToMap(pos, { recenter: true });
                else           maybeInitMap();
              },
              (err) => {
                console.warn("getCurrentPosition error:", err?.message || err);
                geoPos = null; geoReady = 0;
                if (!mapBooted) maybeInitMap(); // boot with fallback center
              },
              GEO_OPTS
            );

            // Continuous updates thereafter
            navigator.geolocation.watchPosition(
              (pos) => {
                geoPos = pos; geoReady = 1;
                if (mapBooted) {
                  // Recenter only once (first fix after boot) unless user hasn't interacted
                  const shouldRecenter = !storedMap?._geocentered && !storedMap?._userInteracted;
                  applyGeolocationToMap(pos, { recenter: shouldRecenter });
                } else {
                  maybeInitMap();
                }
              },
              (err) => {
                console.warn("watchPosition error:", err?.message || err);
                // no fallback center change needed; map may already be up
              },
              GEO_OPTS
            );
          }
        } catch (e) {
          console.warn("Geolocation exception:", e);
          geoPos = null; geoReady = 0; maybeInitMap();
        }

        /* ---------- overlay state ---------- */
        const OverlayStore = { list:[], counter:1 };
        function pushOverlay(rec){ rec.__id = OverlayStore.counter++; OverlayStore.list.push(rec); refreshOverlayChips(); }
        function clearOverlays(){ OverlayStore.list.forEach(o=>{ try{o.shape?.setMap(null);}catch{} }); OverlayStore.list=[]; refreshOverlayChips(); updateResetAvailability(); }
        function refreshOverlayChips(){
            const box = $id("overlayChips");
            if(!box) return;
            box.innerHTML="";
            const any = OverlayStore.list.length>0;
            box.hidden = !any;
            OverlayStore.list.forEach(o=>{
                const chip = document.createElement("span");
                chip.className="overlay-chip"; chip.dataset.ov=o.__id;
                chip.innerHTML = `<span>${o.name || o.type} (#${o.__id})</span><span class="x" title="Remove">✕</span>`;
                chip.querySelector(".x").addEventListener("click", ()=>removeOverlayById(o.__id));
                chip.addEventListener("click", ()=>{
                    if(o.shape?.getBounds){ storedMap.fitBounds(o.shape.getBounds()); }
                    if(o.shape?.getPath && o.shape.getPath().getLength()>0){
                        const b = new google.maps.LatLngBounds();
                        o.shape.getPath().forEach(pt=>b.extend(pt));
                        storedMap.fitBounds(b);
                    }
                });
                box.appendChild(chip);
            });
        }
        function removeOverlayById(id){
            const i = OverlayStore.list.findIndex(o=>o.__id===id);
            if(i>=0){
                try{ OverlayStore.list[i].shape?.setMap(null); }catch{}
                OverlayStore.list.splice(i,1);
                refreshOverlayChips();
                updateResetAvailability();
            }
        }

        (function wireDownloadForm(){
          const form = document.getElementById('pointsListForm');
          const hidden = document.getElementById('bounds_in');
          if (!form || !hidden) return;

          form.addEventListener('submit', function(e){
            // collect markers (sorted) -> FlightPoint shape for server
            const flags = (window.map?.flags || []).slice().sort((a,b)=>a.id - b.id);
            if (flags.length === 0) {
              e.preventDefault();
              alert('No waypoints to export.');
              return;
            }

                // Always send meters to the server
                const payload = flags.map(markerToServerPoint);

            hidden.value = JSON.stringify(payload);
          });
        })();

        /* ---------- units ---------- */
        let unitMode = 0; // 0 metric, 1 imperial
        let usedGenerateAllWithAction = false;
        let suppressUnitsChange = false;
        function labelUnits(){ document.querySelectorAll(".unitsLabel").forEach(el => el.textContent = unitMode ? "ft" : "m"); }
        function convertField(id, factor){
            const el = $id(id); if(!el) return;
            const v = parseFloat(el.value); if(isNaN(v)) return;
            el.value = (v * factor).toFixed(id==="in_distance" ? 1 : 2).replace(/\.00$/,'');
        }
        function refreshActiveInfoWindow(){ if (window.activeIWMarker) openMarkerInfoWindow(window.activeIWMarker); }
        function convertAllWaypointValues(f){
          const flags = (storedMap?.flags || []);
          for (const m of flags){
            if (typeof m.altitude === "number") m.altitude = +(m.altitude * f).toFixed(2);
            if (typeof m.speed    === "number") m.speed    = +(m.speed    * f).toFixed(2);
          }
          // Refresh any views that depend on marker values
          redrawFlightPaths(true);
          updateETA();
          updateWaypointCountWarnings();
          updatePhotoCadenceWarning();
        }
        function adjustConstraintsForUnits(){
          const alt  = $id("altitude");
          const spd  = $id("speed");
          const dist = $id("in_distance");

          if (unitMode) { // Imperial (ft)
            if (alt){  alt.min = "0"; alt.max = String(Math.round(500 * M2FT)); alt.step = "any"; }
            if (spd){  spd.min = "0"; spd.max = String(Math.round( 50 * M2FT)); spd.step = "any"; }
            if (dist){ dist.min = "0"; dist.step = "any"; }
          } else {       // Metric (m)
            if (alt){  alt.min = "0.25"; alt.max = "500"; alt.step = "0.25"; }
            if (spd){  spd.min = "0.25"; spd.max = "50";  spd.step = "0.25"; }
            if (dist){ dist.min = "0.1"; dist.step = "0.1"; }
          }
        }
        function onUnitsChanged(){
          const want = parseInt($id("in_units").value || "0", 10);
          if (want === unitMode) { 
            labelUnits(); 
            refreshActiveInfoWindow(); 
            return; 
          }

          const f = want ? M2FT : (1 / M2FT); // metric->imperial or imperial->metric

          // Convert visible controls and all existing waypoint values
          if (!suppressUnitsChange){
            convertField("altitude",    f);
            convertField("speed",       f);
            convertField("in_distance", f);
            convertAllWaypointValues(f);

            // Optional: if bulk-edit boxes currently have numbers, convert them too
            ["bulkAlt","bulkSpeed"].forEach(id=>{
              const el = $id(id);
              const v  = parseFloat(el?.value);
              if (el && Number.isFinite(v)) el.value = +(v * f).toFixed(2);
            });
          }

          unitMode = want;
          labelUnits();
          updateIntervalOverlap();
          updateETA();
          refreshActiveInfoWindow();
          // Optional: update min/max constraints to the new unit system (see below)
          adjustConstraintsForUnits();
        }

        /* ---------- coverage helpers (null-safe) ---------- */
        function updateIntervalOverlap(){
            const dEl = $id("in_distance");
            const iEl = $id("in_interval");
            const speedEl = $id("speed");
            if (!dEl || !iEl || !speedEl) { updateETA(); return; }
            const d=parseFloat(dEl.value)||0, iv=parseFloat(iEl.value)||1;
            speedEl.value=(d/iv).toFixed(1);
            updateETA();
        }
        function updateOverlap(){
            const ovEl=$id("in_overlap");
            const altEl=$id("altitude");
            const distEl=$id("in_distance");
            if(!ovEl || !altEl || !distEl) return;
            const overlap=((parseFloat(ovEl.value)||0)*0.01)+1;
            const tan=(Math.tan(41.05*(Math.PI/180)));
            const altitude=parseFloat(altEl.value)||0;
            const newDistance=-(overlap*altitude*tan - 2*altitude*tan);
            distEl.value=newDistance.toFixed(1);
            updateIntervalOverlap();
        }

            (function () {
      // Helper that works on both pages
      const $ = (id) => document.getElementById(id);
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

      /* -------------------- Overlap %  ↔  Slider -------------------- */

      function commitOverlapFromField() {
        const field = $('in_overlap');
        if (!field) return;

        let n = Number(field.value);
        if (!Number.isFinite(n)) return; // ignore empties; will clamp on blur

        // Clamp to 50–95 at commit time
        n = clamp(Math.round(n), 25, 95);
        field.value = n;

        // Mirror into slider (respect slider's own range)
        const slider = $('qualitySlider');
        if (slider) {
          const sVal = clamp(n, Number(slider.min || 0), Number(slider.max || 100));
          slider.value = String(sVal);
        }

        // Update the little “Overlap: X%” label if present
        const label = $('qualityValue');
        if (label) label.textContent = String(n);

        // Recompute spacing/speed with your existing math
        if (typeof updateOverlap === 'function') updateOverlap();
      }

      // Wire: commit overlap on blur/change/Enter (not on every keystroke)
      (function wireOverlapField() {
        const field = $('in_overlap');
        if (!field) return;

        field.addEventListener('change', commitOverlapFromField);
        field.addEventListener('blur', commitOverlapFromField);
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); field.blur(); } // triggers blur/commit
        });
      })();

      // Slider -> field (and recompute) — keep this even if you already had it,
      // so both controls stay perfectly in sync.
      (function wireSlider() {
        const slider = $('qualitySlider');
        if (!slider) return;

        slider.addEventListener('input', () => {
          const n = clamp(Math.round(Number(slider.value) || 80), 25, 95);
          const field = $('in_overlap');
          if (field) field.value = n;
          const label = $('qualityValue');
          if (label) label.textContent = String(n);
          if (typeof updateOverlap === 'function') updateOverlap();
        });
      })();

      /* Note: if your slider range is 60–90 but the field is 50–95,
         the slider will move to its nearest edge (60/90) when the field commits to out-of-range values like 50 or 95.
         If you prefer an exact match, change the slider’s min/max to 50/95. */

      /* --------------- Interval locking (veil) logic ---------------- */
    })();

        /* ---------- history ---------- */
        const History = {
            undoStack:[], redoStack:[],
            record(a){ this.undoStack.push(a); this.redoStack.length=0; updateUndoRedoButtons(); },
            undo(){ const a=this.undoStack.pop(); if(!a) return; a.undo(); this.redoStack.push(a);
             updateUndoRedoButtons(); redrawFlightPaths(); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
                 updateGenerateAvailability(); updateAdvancedSettingsAvailability(); maybeJumpBackFromDownloadOnUndo();},
     redo(){ const a=this.redoStack.pop(); if(!a) return; a.redo(); this.undoStack.push(a);
             updateUndoRedoButtons(); redrawFlightPaths(); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
             updateGenerateAvailability(); updateAdvancedSettingsAvailability(); }
        };
        function updateUndoRedoButtons(){
            $id("undoBtn").disabled = History.undoStack.length===0;
            $id("redoBtn").disabled = History.redoStack.length===0;
            updateResetAvailability(); updateExportAvailability(); updateETA();
        }
        $id("undoBtn").addEventListener("click",()=>History.undo());
        $id("redoBtn").addEventListener("click",()=>History.redo());
        $id('deleteSelectedBtn')?.addEventListener('click', deleteSelectionWithHistory);
        document.addEventListener("keydown",(e)=>{
            if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();History.undo();}
            if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.shiftKey&&e.key.toLowerCase()==="z"))){e.preventDefault();History.redo();}
                const mod = modHeld(e);

            if (mod && e.key.toLowerCase() === "c"){
              e.preventDefault();
              copySelectionToClipboard();
            }
            if (mod && e.key.toLowerCase() === "v"){
              e.preventDefault();
              pasteClipboard();
            }
        });

        /* ---------- selection ---------- */
        const Selection = new Set();
        let CTRL_DOWN = false;
        function selectionIds(){ return Array.from(Selection).map(m=>m.id).sort((a,b)=>a-b); }
        function applySelectionByIds(ids){
            if (!ids || ids.length === 0) { try { endTransform(); } catch {} }
            const want = new Set(ids);
            (storedMap?.flags||[]).forEach(m => setMarkerSelected(m, want.has(m.id)));
            Selection.clear();
            (storedMap?.flags||[]).forEach(m => { if (want.has(m.id)) Selection.add(m); });
            updateSelectionUI();
        }
        function deleteSelectionWithHistory(){
              const sel = Array.from(Selection);
              if (!sel.length) return;

              try { endTransform(); } catch {}
              try { storedMap?.infoWindow?.close(); } catch {}

              const beforeSel = selectionIds();

              History.record({
                undo: ()=>{ sel.forEach(addMarkerToMap); applySelectionByIds(beforeSel); renumberWaypointLabels(); },
                redo: ()=>{ sel.forEach(removeMarkerFromStore); applySelectionByIds([]); renumberWaypointLabels(); }
              });

              sel.forEach(removeMarkerFromStore);
              applySelectionByIds([]);
              renumberWaypointLabels();
            }
        document.addEventListener("keydown",(e)=>{
            if(e.key==="Control"||e.metaKey) CTRL_DOWN=true;
            if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){
                e.preventDefault();
                const before = selectionIds();
                const all = (storedMap?.flags||[]).map(m=>m.id);
                applySelectionByIds(all);
                History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds(all) });
            }
        });
        document.addEventListener("keyup",(e)=>{ if(e.key==="Control") CTRL_DOWN=false; });
        function setMarkerSelected(marker,on){
            marker.__selected=!!on;
            const base=marker.getIcon();
            marker.setIcon(Object.assign({},base,{strokeColor:on?'yellow':'white',fillOpacity:on?1:0.8}));
        }
        function toggleSelection(marker){
            // Changing the selection invalidates any cached transform baseline
            try { endTransform(); } catch {}
            try { endHeadingTransform(); } catch {}
            const before = selectionIds();
            const on=!marker.__selected;
            setMarkerSelected(marker,on);
            if(on) Selection.add(marker); else Selection.delete(marker);
            const after = selectionIds();
            updateSelectionUI();
            History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds(after) });
        }
        function clearSelection(){
            (storedMap?.flags||[]).forEach(m=>setMarkerSelected(m,false));
            Selection.clear();
            updateSelectionUI();
        }
        function renumberWaypointLabels(){
            if (!storedMap) return;
            // Display order = by internal id
            const flags = (storedMap.flags || []).slice().sort((a,b)=>a.id - b.id);

            flags.forEach((m, i) => {
                const want = String(i + 1);
                const cur  = (typeof m.getLabel === "function" ? m.getLabel() : m.label) || {};
                if (cur.text !== want){
                // Preserve existing color if any
                m.setLabel(Object.assign({}, cur, { text: want, color: cur.color || "white" }));
                }
            });

          // Optional: keep the hidden starting index sensible for future generations
          const nextDisplayIndex = flags.length + 1;
          const si = document.getElementById("in_startingIndex");
          if (si) si.value = String(nextDisplayIndex);
        }
        function copySelectionToClipboard(){
          const sel = Array.from(Selection);
          if (!sel.length) return;
          const snaps = sel.map(snapMarker);
          const centroid = snaps.reduce((acc,s)=>({lat:acc.lat+s.lat,lng:acc.lng+s.lng}), {lat:0,lng:0});
          centroid.lat /= snaps.length; centroid.lng /= snaps.length;
          Clipboard = { snaps, centroid };
        }

        function pasteClipboard(){
          if (!Clipboard || !Clipboard.snaps?.length) return;

          // Where to paste?
          const anchor = lastMouseLatLng || storedMap?.getCenter?.();
          let dLat = 0, dLng = 0;
          if (anchor){ dLat = anchor.lat() - Clipboard.centroid.lat; dLng = anchor.lng() - Clipboard.centroid.lng; }

          const created = [];
          Clipboard.snaps.forEach(s => {
            const lat = s.lat + dLat, lng = s.lng + dLng;
            const m = createWaypointMarker(
              { lat, lng },
              { heading: s.heading, gimbalAngle: s.angle, action: s.action, turnMode: s.turnMode },
              { skipHistory: true }
            );
            // Copy scalar props explicitly (createWaypointMarker sets defaults)
            m.altitude = s.altitude; m.speed = s.speed; m.angle = s.angle; m.action = s.action; m.turnMode = s.turnMode;
            if (typeof s.useStraightLine === 'number') m.useStraightLine = s.useStraightLine;
            if (typeof s.waypointTurnDampingDist === 'number') m.waypointTurnDampingDist = s.waypointTurnDampingDist;
            setMarkerRotation(m, m.heading || 0);
            created.push(m);
          });

          redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
          applySelectionByIds(created.map(m => m.id));

          History.record({
            undo: () => { created.forEach(removeMarkerFromStore); },
            redo: () => { created.forEach(addMarkerToMap); applySelectionByIds(created.map(m=>m.id)); }
          });
        }

        // Helpers to map ids -> markers then snapshot/apply
        function markersByIds(ids){
          const byId = new Map((storedMap?.flags||[]).map(m => [m.id, m]));
          return ids.map(id => byId.get(id)).filter(Boolean);
        }
        function snapshotsForMarkers(markers){ return markers.map(snapMarker); }
        function applySnapshotsByIds(snaps){
          const ms = markersByIds(snaps.map(s => s.id));
          applySnapshots(ms, snaps);
        }

        /* ---------- ID helpers (keep numbering across generations) ---------- */
        function maxExistingId(){
            const arr = (storedMap?.flags||[]);
            let max = 0;
            for (const m of arr){ if (typeof m.id === "number" && m.id > max) max = m.id; }
            return max;
        }
        function ensureFlagCounter(){
            const next = maxExistingId() + 1;
            if (!window.flagCount || window.flagCount <= maxExistingId()){
                window.flagCount = next;
            }
            $id("in_startingIndex").value = window.flagCount;
        }

        /* ---------- shapes serialize/restore ---------- */
        function serializeCurrentShapes(){
            const out=[];
            (storedMap?.polygons||[]).forEach(pg=>{
                const path=[]; const p=pg.getPath();
                for(let i=0;i<p.getLength();i++){ const v=p.getAt(i); path.push({lat:v.lat(),lng:v.lng()});}
                out.push({type:'polygon',path});
            });
            (storedMap?.circles||[]).forEach(c=>{ out.push({type:'circle',center:{lat:c.getCenter().lat(),lng:c.getCenter().lng()},radius:c.getRadius()}); });
            (storedMap?.rectangles||[]).forEach(r=>{
                const b=r.getBounds(); const ne=b.getNorthEast(), sw=b.getSouthWest();
                out.push({type:'rectangle',bounds:{n:ne.lat(),e:ne.lng(),s:sw.lat(),w:sw.lng()}})
            });
            return out;
        }
        function removeShapeFromStore(shape){
            if(!storedMap||!shape) return;
            shape.setMap(null);
            if(shape.wmType==="polygon") storedMap.polygons = (storedMap.polygons||[]).filter(x=>x!==shape);
            if(shape.wmType==="circle") storedMap.circles = (storedMap.circles||[]).filter(x=>x!==shape);
            if(shape.wmType==="rectangle") storedMap.rectangles = (storedMap.rectangles||[]).filter(x=>x!==shape);
        }
        /* Add a shape back (for redo/undo) */
            function addShapeToStore(shape){
        if(!storedMap || !shape) return;

        // Infer wmType if missing
        if(!shape.wmType){
            if (shape instanceof google.maps.Polygon)   shape.wmType = "polygon";
            else if (shape instanceof google.maps.Circle)    shape.wmType = "circle";
            else if (shape instanceof google.maps.Rectangle) shape.wmType = "rectangle";
        }

        // Put on map
        if (!shape.getMap()) shape.setMap(storedMap);

        // Track in our lists without duplicates
        if(shape.wmType==="polygon"){
            (storedMap.polygons||(storedMap.polygons=[]));
            if(!storedMap.polygons.includes(shape)) storedMap.polygons.push(shape);
        }else if(shape.wmType==="circle"){
            (storedMap.circles||(storedMap.circles=[]));
            if(!storedMap.circles.includes(shape)) storedMap.circles.push(shape);
        }else if(shape.wmType==="rectangle"){
            (storedMap.rectangles||(storedMap.rectangles=[]));
            if(!storedMap.rectangles.includes(shape)) storedMap.rectangles.push(shape);
        }

        // Bind listeners only once per shape
        if(!shape.__wmBound){
            hookChangeListeners(shape);
            attachShapeClick(storedMap, shape);
            shape.__wmBound = true;
        }

        updateGenerateAvailability();
    }
        function restoreShapesFrom(descs){
            if(!storedMap) return [];
            const created=[];
            descs.forEach(d=>{
                if(d.type==='polygon'){
                    const pg=new google.maps.Polygon({paths:d.path,editable:true,draggable:true,clickable:true,map:storedMap});
                    pg.wmType="polygon"; (storedMap.polygons||(storedMap.polygons=[])).push(pg); hookChangeListeners(pg); attachShapeClick(storedMap, pg); created.push(pg);
                }else if(d.type==='circle'){
                    const c=new google.maps.Circle({center:d.center,radius:d.radius,editable:true,draggable:true,clickable:true,map:storedMap});
                    c.wmType="circle"; (storedMap.circles||(storedMap.circles=[])).push(c); hookChangeListeners(c); attachShapeClick(storedMap, c); created.push(c);
                }else if(d.type==='rectangle'){
                    const b=new google.maps.LatLngBounds(new google.maps.LatLng(d.bounds.s,d.bounds.w),new google.maps.LatLng(d.bounds.n,d.bounds.e));
                    const r=new google.maps.Rectangle({bounds:b,editable:true,draggable:true,clickable:true,map:storedMap});
                    r.wmType="rectangle"; (storedMap.rectangles||(storedMap.rectangles=[])).push(r); hookChangeListeners(r); attachShapeClick(storedMap, r); created.push(r);
                }
            });
            updateGenerateAvailability();
            return created;
        }

        /* ---------- shapes helpers ---------- */
        function polygonToString(poly){ const path=poly.getPath(),parts=[]; for(let i=0;i<path.getLength();i++){ const p=path.getAt(i); parts.push(p.lat()+","+p.lng()); } return parts.join(";")+";"; }
        function circleToString(circle){ const c=circle.getCenter(); return circle.getRadius()+";("+c.lat()+","+c.lng()+")"; }
        function rectToPolygonString(rect){
            const b=rect.getBounds(), ne=b.getNorthEast(), sw=b.getSouthWest();
            const nw=new google.maps.LatLng(ne.lat(),sw.lng()); const se=new google.maps.LatLng(sw.lat(),ne.lng());
            const pts=[sw,se,ne,nw]; return pts.map(p=>p.lat()+","+p.lng()).join(";")+";";
        }
        function writeHiddenFromShape(shape){
            let typ=shape.wmType, v="";
            if (typ==="rectangle"){ typ="polygon"; v=rectToPolygonString(shape); }
            else if (typ==="polygon"){ v=polygonToString(shape); }
            else if (typ==="circle"){ v=circleToString(shape); }
            $id("boundsType").value=typ; $id("pass").value=v;
        }
        function hookChangeListeners(shape){
            const t=shape.wmType;
            if (t==="polygon"){ const path=shape.getPath(); ["insert_at","set_at","remove_at"].forEach(evt=>path.addListener(evt,()=>writeHiddenFromShape(shape))); }
            else if (t==="circle"){ ["radius_changed","center_changed"].forEach(evt=>shape.addListener(evt,()=>writeHiddenFromShape(shape))); }
            else if (t==="rectangle"){ shape.addListener("bounds_changed",()=>writeHiddenFromShape(shape)); }
        }

        /* ---------- availability + UI glue ---------- */
        function hasAnyShapes(){
            return storedMap && (((storedMap.polygons?.length||0)+(storedMap.circles?.length||0)+(storedMap.rectangles?.length||0))>0);
        }
        function updateQualitySliderAvailability(){
            const enabled = hasAnyShapes();
            const qs = $id("qualitySlider");
            if (qs) qs.disabled = !enabled;
            const block = $id("sliderBlock");
            if (block) block.classList.toggle("dimmed", !enabled);
        }
        function updateGenerateAvailability(){
            const hasShapes = hasAnyShapes();
            const hasFlags  = (storedMap?.flags?.length||0) > 0;
            $id("generate").disabled = !hasShapes;
            const pbtn=$id("presetGenBtn"); if (pbtn) pbtn.disabled = !hasShapes;
            const hideOverlay = hasShapes || hasFlags;
            $id("hintText").hidden = hideOverlay;
            const ov=$id("drawOverlay"); if (ov) ov.classList.toggle("hidden", hideOverlay);
            updateQualitySliderAvailability();
            updateResetAvailability();updateAdvancedSettingsAvailability();
        }
        function updateResetAvailability(){
            const hasShapes = hasAnyShapes();
            const hasFlags = (storedMap?.flags?.length||0)>0;
            const hasOverlays = (OverlayStore.list.length>0);
            $id("clear").disabled = !(hasShapes || hasFlags || hasOverlays);
        }
        function updateTimedShotsNote(){
          const flags = (storedMap?.flags || []);
          const hasFlags = flags.length > 0;

          // Show the warning only when there are points AND none of them has any action
          // (i.e., all are "noAction"). This matches your desired behavior.
          const hasAnyAction = flags.some(m => m.action && m.action !== "noAction");
          const show = hasFlags && !hasAnyAction;

          $id("timedShotsNote")?.classList.toggle("hide", !show);
        }
        function updateExportAvailability(){
            const hasFlags=(storedMap?.flags||[]).length>0;
            $id("downloadBtn").disabled=!hasFlags;
            $id("saveBtn").disabled=!hasFlags;
            if ($id("splitDownloadBtn")) $id("splitDownloadBtn").disabled=!hasFlags || !IS_PREMIUM;
            // Toggle the download veil
            const wrap = $id('downloadWrap');
            if (wrap) wrap.classList.toggle('waypoint-locked', !hasFlags);
            updateExportControls();
            updateTimedShotsNote();
            updateWaypointCountWarnings();
            updatePhotoCadenceWarning();
            updateEmptyDownloadVeils();
        }

        /* ---------- path + ETA ---------- */
        function haversine(a,b){ const toRad=v=>v*Math.PI/180; const R=6371000, dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng); const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*(Math.sin(dLng/2)**2); return 2*R*Math.asin(Math.sqrt(s)); }
        function estimateMissionSeconds(){
            const flags=(storedMap?.flags||[]).slice().sort((a,b)=>a.id-b.id);
            if (flags.length<2) return 0;
            let t=0;
            for(let i=1;i<flags.length;i++){
                const a=flags[i-1], b=flags[i];
                const dist=haversine({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng});
                const spd=((a.speed||2.5)+(b.speed||2.5))/2;
                const spdMps = unitMode ? (spd/M2FT) : spd;
                if (spdMps>0) t += dist / spdMps;
            }
            t += flags.length * 0.8;
            return t;
        }
        function fmtTime(sec){ if(!sec||sec<=0) return "—"; const m=Math.floor(sec/60), s=Math.round(sec%60); return `${m}m ${String(s).padStart(2,'0')}s`; }
        function updateETA(){ $id("etaText").textContent = fmtTime(estimateMissionSeconds()); }

        /* ---------- bearings ---------- */
        function bearingDeg(a,b){
            const toRad=v=>v*Math.PI/180, toDeg=r=>r*180/Math.PI;
            const φ1=toRad(a.lat), φ2=toRad(b.lat), λ1=toRad(a.lng), λ2=toRad(b.lng);
            const y=Math.sin(λ2-λ1)*Math.cos(φ2);
            const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
            return (toDeg(Math.atan2(y,x))+360)%360;
        }
        function updatePreviousHeadingFromNew(newMarker){
            const flags = (storedMap?.flags || []).slice().sort((a,b)=>a.id - b.id);
            const idx = flags.findIndex(f => f === newMarker);
            if (idx <= 0) return; // nothing to update

            const prev = flags[idx - 1];
            const before = snapMarker(prev);

            const brg = Math.round(
                bearingDeg(
                    { lat: prev.lat, lng: prev.lng },
                    { lat: newMarker.lat, lng: newMarker.lng }
                )
            );

            prev.heading = brg;
            setMarkerRotation(prev, brg);

            const after = snapMarker(prev);
            History.record({
                undo: () => applyMarkerSnapshot(prev, before),
                redo: () => applyMarkerSnapshot(prev, after)
            });

            if (window.activeIWMarker === prev) {
                openMarkerInfoWindow(prev); // refresh IW UI
            }
        }
        function lastMarkerById(){ const f=(storedMap?.flags||[]); if(!f.length) return null; let best=f[0]; for(const m of f){ if(m.id>best.id) best=m; } return best; }

        /* ---------- InfoWindow ---------- */
        const TURN_OPTIONS = [
            {v:"coordinateTurn",t:"Curved (coordinated turn)"},
            {v:"toPointAndPassWithContinuityCurvature",t:"Curved (pass through)"},
            {v:"toPointAndStopWithContinuityCurvature",t:"Curved (stop at point)"},
            {v:"toPointAndStopWithDiscontinuityCurvature",t:"Sharp corner (stop at point)"}
        ];
        function openMarkerInfoWindow(marker){
              if(!storedMap?.infoWindow) return;
              window.activeIWMarker = marker;

              const genInfoWindow = storedMap.infoWindow;
              const unitLen = unitMode ? "ft" : "m";
              const unitSpd = unitMode ? "ft/s" : "m/s";

            const turnSelect = TURN_OPTIONS.map(o=>`<option value="${o.v}">${o.t}</option>`).join("");

            const iwHtml =
            '<div class="gm-iw-section">'+
              '<div class="row g-1">'+
                '<div class="col-6"><div class="input-group input-group-sm">'+
                  '<span class="input-group-text">Lat</span>'+
                  '<input id="iw-lat" type="number" step="0.0000001" class="form-control" value="'+marker.lat+'"></div></div>'+
                '<div class="col-6"><div class="input-group input-group-sm">'+
                  '<span class="input-group-text">Lng</span>'+
                  '<input id="iw-lng" type="number" step="0.0000001" class="form-control" value="'+marker.lng+'"></div></div>'+
                '<div class="col-6"><div class="input-group input-group-sm mt-1">'+
                  '<span class="input-group-text">Alt</span>'+
                  '<input id="iw-alt" type="number" step="0.25" class="form-control" value="'+marker.altitude+'"><span class="input-group-text">'+unitLen+'</span></div></div>'+
                '<div class="col-6"><div class="input-group input-group-sm mt-1">'+
                  '<span class="input-group-text">Speed</span>'+
                  '<input id="iw-speed" type="number" step="0.25" class="form-control" value="'+marker.speed+'"><span class="input-group-text">'+unitSpd+'</span></div></div>'+
                '<div class="col-6"><div class="input-group input-group-sm mt-1">'+
                  '<span class="input-group-text">Angle</span>'+
                  '<input id="iw-angle" type="number" step="0.25" class="form-control" value="'+marker.angle+'"><span class="input-group-text">deg</span></div></div>'+
                '<div class="col-6"><div class="input-group input-group-sm mt-1">'+
                  '<span class="input-group-text">Heading</span>'+
                  '<input id="iw-heading" type="number" step="0.25" class="form-control" value="'+marker.heading+'"><span class="input-group-text">deg</span></div></div>'+
                '<div class="col-12 mt-1">'+
                  '<select id="iw-action" class="form-select form-select-sm">'+
                    '<option value="noAction">No Action</option>'+
                    '<option value="takePhoto">Take Picture</option>'+
                    '<option value="startRecord">Start Recording</option>'+
                    '<option value="stopRecord">Stop Recording</option>'+
                  '</select></div>'+
                '<div hidden class="col-12 mt-1">'+
                  '<label class="form-label">Turn mode</label>'+
                  '<select id="iw-turnMode" class="form-select form-select-sm">'+ turnSelect + '</select>'+
                '</div>'+
              '</div>'+
              '<div class="gm-iw-actions"><button id="iw-save" class="btn btn-primary btn-sm">Save</button>'+
              '<button id="iw-del" class="btn btn-outline-danger btn-sm">Delete</button></div>'+
            '</div>';
            // Create a root node so we can scope queries and verify identity
          const root = document.createElement('div');
          root.className = 'wm-iw';
          root.innerHTML = iwHtml;

          // Token guards against content swaps between schedule and fire
          genInfoWindow._wmToken = (genInfoWindow._wmToken || 0) + 1;
          const myToken = genInfoWindow._wmToken;

          genInfoWindow.setContent(root);
          genInfoWindow.open(marker.map, marker);

          google.maps.event.addListenerOnce(genInfoWindow, "domready", () => {
            // If content was replaced, do nothing.
            if (genInfoWindow._wmToken !== myToken) return;
            if (genInfoWindow.getContent() !== root) return;

            // Query within our root, not the whole document
            const sel     = root.querySelector("#iw-action");
            const tm      = root.querySelector("#iw-turnMode");
            const saveBtn = root.querySelector("#iw-save");
            const delBtn  = root.querySelector("#iw-del");

            if (sel) sel.value = marker.action || "noAction";
            if (tm)  tm.value  = marker.turnMode || "coordinateTurn";

            if (saveBtn) saveBtn.addEventListener("click", function(){
              const before = snapMarker(marker);
              const nl     = parseFloat(root.querySelector("#iw-lat")?.value);
              const ng     = parseFloat(root.querySelector("#iw-lng")?.value);
              const na     = parseFloat(root.querySelector("#iw-alt")?.value);
              const ns     = parseFloat(root.querySelector("#iw-speed")?.value);
              const nang   = parseFloat(root.querySelector("#iw-angle")?.value);
              const nh     = parseFloat(root.querySelector("#iw-heading")?.value);
              const nact   = root.querySelector("#iw-action")?.value;
              const nturn  = root.querySelector("#iw-turnMode")?.value;

              const after  = {
                id: marker.id,
                lat: !isNaN(nl)?nl:marker.lat,
                lng: !isNaN(ng)?ng:marker.lng,
                altitude: !isNaN(na)?na:marker.altitude,
                speed: !isNaN(ns)?ns:marker.speed,
                angle: !isNaN(nang)?nang:marker.angle,
                heading: !isNaN(nh)?nh:marker.heading,
                action: nact || marker.action,
                turnMode: nturn || marker.turnMode
              };

              applyMarkerSnapshot(marker, after);
              redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning(); updateTimedShotsNote();

              History.record({ undo: ()=>applyMarkerSnapshot(marker,before),
                               redo: ()=>applyMarkerSnapshot(marker,after) });
            });

            if (delBtn) delBtn.addEventListener("click", function(){
              const ref = marker;
              History.record({ undo: ()=>addMarkerToMap(ref), redo: ()=>removeMarkerFromStore(ref) });
              removeMarkerFromStore(marker);
            });
          });
        }

        /* ---------- waypoint creation ---------- */
        function createWaypointMarker(position, props, options){
            options=options||{}; if(!storedMap) return null;
                ensureFlagCounter();

                const lat = typeof position.lat==="function" ? position.lat() : position.lat;
                const lng = typeof position.lng==="function" ? position.lng() : position.lng;

                    const altitude = (props && Number.isFinite(+props.altitude))
                       ? +props.altitude
                       : (parseFloat($id("altitude").value) || 60);
                     const speed    = (props && Number.isFinite(+props.speed))
                       ? +props.speed
                       : (parseFloat($id("speed").value) || 2.5);

                // BEFORE: always used the UI field (-45)
                // const angle = parseFloat($id("angle").value) || -45;

                // AFTER: honor server override if provided (p.gimbalAngle)
                const angle    = (props && typeof props.gimbalAngle === "number")
                    ? props.gimbalAngle
                    : (parseFloat($id("angle").value) || -45);

                const action   = (props && props.action) || ($id("in_allPointsAction") ? $id("in_allPointsAction").value : "noAction");
                const heading  = (props && typeof props.heading === "number") ? props.heading : 0;

                let turnMode;
                if (options?.isGenerated === true) {
                  const straightenOn = !!$id("in_straightenLines")?.checked;
                  turnMode = (IS_PREMIUM && straightenOn)
                    ? "toPointAndStopWithDiscontinuityCurvature"
                    : "coordinateTurn";
                } else {
                  turnMode = (props && props.turnMode) || "coordinateTurn";
                }

                // NEW: straight-line hint & damping distance (meters)
                 const straightToggle = !!$id("in_straightenLines")?.checked;
                 const useStraightLine = (props && typeof props.useStraightLine === "number")
                   ? props.useStraightLine
                   : (straightToggle ? 1 : 0);

                 // 0 m damping for “sharp corner” feel when straightening; 20 m otherwise (your current default)
                 const waypointTurnDampingDist = (props && typeof props.waypointTurnDampingDist === "number")
                   ? props.waypointTurnDampingDist
                   : (straightToggle ? 0 : 20);

            const icon={path:'M 230 80 A 45 45, 0, 1, 0, 275 125 L 275 80 Z', fillOpacity:.8, fillColor:'blue',
                anchor:new google.maps.Point(228,125), strokeWeight:3, strokeColor:'white', scale:.5, rotation:heading-45, labelOrigin:new google.maps.Point(228,125)};

            const marker=new google.maps.Marker({position:{lat,lng}, map:storedMap, label:{text:String(window.flagCount),color:"white"}, draggable:true, icon, id:window.flagCount});
            marker.lat=lat; marker.lng=lng; marker.altitude=altitude; marker.speed=speed; marker.heading=heading; marker.angle=angle; marker.action=action; marker.turnMode=turnMode;
            marker.useStraightLine = useStraightLine;
            marker.waypointTurnDampingDist = waypointTurnDampingDist;

            google.maps.event.addListener(marker,"click", function(e){
              // back to hand
              window.Draw?.cancel?.();
              applyMapCursor(null);
              storedMap?.setOptions?.({ draggable: true, draggableCursor: null, draggingCursor: null });
              document.querySelectorAll('#drawToolbar .btn').forEach(b => b.classList.remove('active'));

              const dom = e && (e.domEvent || e);
              const isToggle = !!(dom && (dom.ctrlKey || dom.metaKey)) || CTRL_DOWN;
              if (isToggle) { toggleSelection(this); return; }

              openMarkerInfoWindow(this);
            });
            google.maps.event.addListener(marker,"dragstart",function(){
                // If a rotate/scale/heading session is alive, kill it.
              try { endTransform(); } catch {}
              try { endHeadingTransform(); } catch {}
              this.__dragStart = snapMarker(this);

              // keep “Ctrl + Drag” behavior consistent with your keybind text
              const wantGroup = CTRL_DOWN && this.__selected && Selection.size > 1;

              GroupDrag = wantGroup ? {
                ref: this,
                anchor: new google.maps.LatLng(this.lat, this.lng),
                originals: Array.from(Selection).map(m => ({ m, lat: m.lat, lng: m.lng }))
              } : null;
            });
            document.addEventListener('keydown', (e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace') &&
                  Selection.size > 0 &&
                  !typingInField(e.target)){
                e.preventDefault();
                deleteSelectionWithHistory();
              }
            });

            google.maps.event.addListener(marker,"drag",function(){
              // ALWAYS keep the ref’s stored coordinates current
              const pos = this.getPosition();
              this.lat = pos.lat(); this.lng = pos.lng();

              if (!GroupDrag) {
                redrawFlightPaths(true); updateETA();
                return;
              }

              const dLat = pos.lat() - GroupDrag.anchor.lat();
              const dLng = pos.lng() - GroupDrag.anchor.lng();

              GroupDrag.originals.forEach(({m, lat, lng})=>{
                if (m === GroupDrag.ref) return;   // ref handled above
                const nlat = lat + dLat, nlng = lng + dLng;
                m.setPosition({lat:nlat, lng:nlng});
                m.lat = nlat; m.lng = nlng;
              });

              redrawFlightPaths(true); updateETA();
            });

            google.maps.event.addListener(marker,"dragend",function(){
              if (GroupDrag){
                const before = GroupDrag.originals.map(({m,lat,lng}) => {
                const s = snapMarker(m);
                s.lat = lat; s.lng = lng;
                return s;
              });
                const after  = GroupDrag.originals.map(({m}) => snapMarker(m));

                History.record({
                  undo: () => applySnapshotsByIds(before),
                  redo: () => applySnapshotsByIds(after)
                });

                GroupDrag = null;
                redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
                return;
              }

              // single-marker move history
              const before=this.__dragStart||snapMarker(this);
              const after = snapMarker(this);   // already updated during drag
              History.record({undo:()=>applyMarkerSnapshot(this,before), redo:()=>applyMarkerSnapshot(this,after)});
              redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
            });




            addMarkerToStore(marker);
            window.flagCount += 1; $id("in_startingIndex").value = window.flagCount;
            if(!options.skipHistory){ History.record({undo:()=>removeMarkerFromStore(marker), redo:()=>addMarkerToMap(marker)}); }
            return marker;
        }
        function snapMarker(m){ return {
            id: m.id, lat: m.lat, lng: m.lng, altitude: m.altitude, speed: m.speed,
            angle: m.angle, heading: m.heading, action: m.action, turnMode: m.turnMode,
            useStraightLine: (typeof m.useStraightLine === 'number' ? m.useStraightLine : 0),
            waypointTurnDampingDist: (typeof m.waypointTurnDampingDist === 'number' ? m.waypointTurnDampingDist : 20)
          }; }
        function applyMarkerSnapshot(m,s){ m.lat=s.lat; m.lng=s.lng; m.altitude=s.altitude; m.speed=s.speed; m.angle=s.angle; m.heading=s.heading; m.action=s.action; m.turnMode=s.turnMode||m.turnMode; 
            if (typeof s.useStraightLine === 'number') m.useStraightLine = s.useStraightLine;
            if (typeof s.waypointTurnDampingDist === 'number') m.waypointTurnDampingDist = s.waypointTurnDampingDist;
            m.setPosition({lat:s.lat,lng:s.lng}); setMarkerRotation(m,s.heading||0); }
        function addMarkerToStore(marker){
            if (!marker.getMap()) marker.setMap(storedMap);
            (storedMap.flags||(storedMap.flags=[]));
            if (!storedMap.flags.includes(marker)) storedMap.flags.push(marker);
            (window.flightPoints||(window.flightPoints=[]));
            if (!window.flightPoints.some(p=>p.lat===marker.lat && p.lng===marker.lng)){
                window.flightPoints.push({lat:marker.lat,lng:marker.lng});
            }
            updateExportAvailability(); redrawFlightPaths(true); updateETA(); updateResetAvailability(); updateSelectionUI(); updateWaypointCountWarnings(); updatePhotoCadenceWarning(); updateGenerateAvailability();renumberWaypointLabels();
        }
        function removeMarkerFromStore(marker){
            marker.setMap(null);
            storedMap.flags=(storedMap.flags||[]).filter(m=>m!==marker);
            window.flightPoints=(window.flightPoints||[]).filter(p=>!(p.lat===marker.lat && p.lng===marker.lng));
            Selection.delete(marker);
            updateExportAvailability(); redrawFlightPaths(true); updateETA(); updateResetAvailability(); updateSelectionUI(); updateWaypointCountWarnings(); updatePhotoCadenceWarning(); updateGenerateAvailability();renumberWaypointLabels();
        }
        function addMarkerToMap(marker){ addMarkerToStore(marker); }
        function setMarkerRotation(marker, heading){
           // Keep rotation in [-180, 180) so Google Maps doesn't "flip" across 180°
           const rot = (((heading || 0) - 45 + 540) % 360) - 180;
           marker.setIcon(Object.assign({}, marker.getIcon(), { rotation: rot }));
        }

        /* ---------- clear/reset ---------- */
        function clearGenerated(){
            if(!storedMap) return;
            const markers=(storedMap.flags||[]).slice();
            if(markers.length){
                History.record({ undo:()=>markers.forEach(m=>{ m.setMap(storedMap); addMarkerToStore(m);} ),
                                 redo:()=>markers.forEach(m=>removeMarkerFromStore(m)) });
            }
            markers.forEach(m=>removeMarkerFromStore(m));
            storedMap.lines=[]; storedMap.curvedPreview=[]; window.flightPoints=[];
            usedGenerateAllWithAction = false;
                redrawFlightPaths(true); updateExportAvailability(); updateETA(); updateResetAvailability(); updateWaypointCountWarnings(); updatePhotoCadenceWarning(); refreshGenStaleNote();
        }

        const fromMetersLen = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? (unitMode ? n * M2FT : n) : n; // imperial? feet : meters
};

        let IS_GENERATING = false;
        /* ---------- generate (batch) ---------- */
            async function generateAllShapes(){
                  if (IS_GENERATING) return;          // ignore while in flight
  IS_GENERATING = true;
  try {
    // disable UI affordances while generating
    document.getElementById('generate')?.setAttribute('disabled', 'true');
    document.getElementById('presetGenBtn')?.setAttribute('disabled', 'true');

                if(!storedMap) return;
                const shapesAll=[].concat(storedMap.polygons||[], storedMap.circles||[], storedMap.rectangles||[]);
                if(shapesAll.length===0) return;

                // Keep references to the actual shape objects currently on the map
                const removedShapeRefs = shapesAll.slice(); // array of original shape objects

                ensureFlagCounter();

                const created=[];
                async function generateFor(boundsStr,typeStr){
                    const data=new FormData($id("mainForm"));
                    data.set("bounds",boundsStr); data.set("boundsType",typeStr); data.set("in_startingIndex",window.flagCount);

                    // Normalize line direction + orientation for server
                    const uiMode = ($id("in_lineAngleMode")?.value || "preset");
                    let sendMode = uiMode;
                    let sendOrientation = "0"; // 0=E–W, 1=N–S
                    if (uiMode === "presetNS") { sendMode = "preset"; sendOrientation = "1"; }
                    if (uiMode === "preset")   { sendMode = "preset"; sendOrientation = "0"; }
                    data.set("in_lineAngleMode", sendMode);
                    data.set("in_lineOrientation", sendOrientation);
                    data.set("in_lineAngleDegrees", ($id("in_lineAngleDegrees")?.value || "0"));
                    const straightenOn = !!($id("in_straightenLines") && $id("in_straightenLines").checked);
                    const derivedTurnMode = (IS_PREMIUM && straightenOn)
                      ? "toPointAndStopWithDiscontinuityCurvature"   // sharp corner
                      : "coordinateTurn";                             // curved (default)

                    data.set("in_turnMode", derivedTurnMode);

                    const res=await fetch("/Home/GeneratePoints",{method:"post",body:data});
                    const txt=await res.text();
                    if(!res.ok){ console.error("GeneratePoints failed",res.status,txt); alert("Generate failed ("+res.status+"). See console."); return; }
                    let pts; try{ pts=JSON.parse(txt);}catch{ console.error("Non‑JSON:",txt); alert("Generate failed (invalid response)."); return; }
                    for(let i=0;i<pts.length;i++){
                        const p=pts[i];
                        const m = createWaypointMarker(
                       { lat: p.Latitude, lng: p.Longitude },
                       {
                         heading: p.heading || 0,
                         turnMode: p.turnMode,
                         gimbalAngle: p.gimbalAngle,
                         action: p.action,
                         altitude: Number.isFinite(+p.altitude) ? fromMetersLen(p.altitude) : undefined,
                         useStraightLine: p.useStraightLine,
                         waypointTurnDampingDist: p.waypointTurnDampingDist
                       },
                       { skipHistory: true }
                     );
                        created.push(m);
                    }
                    $id("in_startingIndex").value = window.flagCount;
                }

                // Build the bounds strings for each shape
                const all=[].concat(storedMap.polygons||[], storedMap.circles||[], storedMap.rectangles||[]);
                for(const s of all){
                    let boundsStr="", typeStr="";
                    if(s.wmType==="polygon"){ typeStr="polygon"; boundsStr=polygonToString(s); }
                    if(s.wmType==="circle"){  typeStr="circle";  boundsStr=circleToString(s); }
                    if(s.wmType==="rectangle"){typeStr="polygon"; boundsStr=rectToPolygonString(s); }
                    await generateFor(boundsStr,typeStr);
                }

                const usedAll = !!$id("in_generateAllPoints") && $id("in_generateAllPoints").checked &&
                                !!$id("in_allPointsAction") && $id("in_allPointsAction").value !== "noAction";
                if (usedAll) usedGenerateAllWithAction = true;
                updateTimedShotsNote();

                // History: on Undo, remove generated points and re‑add ORIGINAL shapes by reference.
                if(created.length){
                    let shapesAreOnMap = false;
                    History.record({
                        undo: ()=>{ created.forEach(m=>removeMarkerFromStore(m));
                                    removedShapeRefs.forEach(s=>addShapeToStore(s));
                                    shapesAreOnMap = true;
                                    updateGenerateAvailability(); },
                        redo: ()=>{ if (shapesAreOnMap){
                                        removedShapeRefs.forEach(s=>removeShapeFromStore(s));
                                        shapesAreOnMap = false;
                                    }
                                    created.forEach(m=>addMarkerToMap(m));
                                    updateGenerateAvailability(); }
                    });
                }

                // Finally clear shapes from the map (we still hold references in history)
                removeAllShapes();
                updateGenerateAvailability(); updateExportAvailability(); redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
                lastGenerateSig = getGenerateSignature();
                    refreshGenStaleNote();goToDownloadAfterGeneration();
            } finally {
    document.getElementById('generate')?.removeAttribute('disabled');
    document.getElementById('presetGenBtn')?.removeAttribute('disabled');
    IS_GENERATING = false;
  }
}


        function removeAllShapes(){
            if(!storedMap) return;
            (storedMap.polygons||[]).forEach(s=>s.setMap(null));
            (storedMap.circles||[]).forEach(s=>s.setMap(null));
            (storedMap.rectangles||[]).forEach(s=>s.setMap(null));
            storedMap.polygons=[]; storedMap.circles=[]; storedMap.rectangles=[];
            $id("boundsType").value=""; $id("pass").value="";
            updateResetAvailability(); updateQualitySliderAvailability();
        }

        /* ---------- shape click infobox ---------- */
        function attachShapeClick(map, shape){
          google.maps.event.addListener(shape, "click", (e) => {
            const iw  = map.infoWindow;
            const pos = e?.latLng || shape.getBounds?.()?.getCenter?.() || shape.getCenter?.();

            // Build a root node and wire events BEFORE opening (no domready race)
            const root = document.createElement('div');
            root.innerHTML = `
              <div class="text-center">
                <h6 class="mb-2">Generate waypoints for this shape?</h6>
                <div class="d-grid gap-2">
                  <button class="btn btn-success btn-sm" id="shapeGenBtn">Generate</button>
                  <button class="btn btn-outline-danger btn-sm" id="shapeRemoveBtn">Remove</button>
                </div>
                <small class="text-muted d-block mt-2">
                  Tip: Draw multiple shapes, then click <b>Generate</b> to process them all.
                </small>
              </div>`;

            // Optional: token to ignore stale clicks if the window gets reused
            iw._wmToken = (iw._wmToken || 0) + 1;
            const myToken = iw._wmToken;
            const onlyIfMine = (fn) => (...args) => { if (iw._wmToken === myToken) fn(...args); };

            root.querySelector("#shapeGenBtn")?.addEventListener("click", onlyIfMine(() => {
              generateAllShapes();
              iw.close();
            }));

            root.querySelector("#shapeRemoveBtn")?.addEventListener("click", onlyIfMine((ev) => {
              ev.preventDefault();
              removeSelectedShape(ev);
            }));

            iw.setContent(root);       // pass a Node, not a string
            if (pos) iw.setPosition(pos);
            iw.open({ map });

            window.selectedShape = shape;
            writeHiddenFromShape(shape);
            document.getElementById("submitbtn").disabled = false;
          });
        }


        function removeSelectedShape(ev){
            if(ev){ ev.stopPropagation(); ev.cancelBubble=true; }
            if(!window.selectedShape||!storedMap) return;

            const s=window.selectedShape;
            // make removal undoable
            History.record({
                undo: ()=>{ addShapeToStore(s); },
                redo: ()=>{ removeShapeFromStore(s); }
            });

            removeShapeFromStore(s);
            storedMap.infoWindow.close(); window.selectedShape=null; updateGenerateAvailability();
        }

        /* ---------- Clear & Generate buttons ---------- */
            $id("clear").addEventListener("click", function(){
        if(!storedMap) return;

            // Capture references to currently drawn shapes
            const removedShapeRefs = [].concat(storedMap.polygons||[], storedMap.circles||[], storedMap.rectangles||[]);

            // Make clearing shapes undoable using the same objects
            History.record({
                undo: ()=>{ removedShapeRefs.forEach(s=>addShapeToStore(s)); updateGenerateAvailability(); },
                redo: ()=>{ removedShapeRefs.forEach(s=>removeShapeFromStore(s)); updateGenerateAvailability(); }
            });

            removeAllShapes();           // shapes
            clearGenerated();            // waypoints (has its own history entry)
            clearSelection();
            clearOverlays();

            window.flagCount=1; $id("in_startingIndex").value=window.flagCount;
            $id("saveBtn").disabled=true; updateGenerateAvailability(); updateExportAvailability();
                updateSelectionUI(); updateWaypointCountWarnings(); updatePhotoCadenceWarning(); lastGenerateSig = getGenerateSignature(); refreshGenStaleNote();
        }, false);
        $id("generate").addEventListener("click", function(e){ e.preventDefault(); if(this.disabled) return; generateAllShapes(); });
        $id("presetGenBtn")?.addEventListener("click", function(){ if(!this.disabled) generateAllShapes(); });

        /* ---------- Map boot ---------- */
        let lati=0,longi=0,zoomin=2;
        // One place to handle user location updates
        function applyGeolocationToMap(pos, opts){
          opts = opts || {};
          const recenter = !!opts.recenter;

          if (!storedMap || !pos?.coords) return;

          const { latitude, longitude, accuracy } = pos.coords;
          const latLng = new google.maps.LatLng(latitude, longitude);

          // Create or move a dedicated "you are here" marker
          if (!storedMap.userMarker){
            storedMap.userMarker = new google.maps.Marker({
              map: storedMap,
              position: latLng,
              title: "Current Location"
            });
          } else {
            storedMap.userMarker.setPosition(latLng);
          }

          // Optional accuracy circle (comment out if you don't want it)
          if (typeof accuracy === "number"){
            if (storedMap.userCircle) storedMap.userCircle.setMap(null);
            storedMap.userCircle = new google.maps.Circle({
              map: storedMap,
              center: latLng,
              radius: accuracy,
              clickable: false,
              strokeColor: "#0d6efd",
              strokeOpacity: 0.5,
              strokeWeight: 1,
              fillColor: "#0d6efd",
              fillOpacity: 0.08
            });
          }

          // Recenter only once or when explicitly asked, and only if user hasn't interacted
          if (recenter && !storedMap._userInteracted){
            storedMap.setCenter(latLng);
            if ((storedMap.getZoom() || 0) < 14) storedMap.setZoom(17);
            storedMap._geocentered = true;
          }
        }

        function bootMap(position, hasGeo){
            if(hasGeo==1){ lati=position.coords.latitude; longi=position.coords.longitude; zoomin=17; }
            const mapTypeIdVal = (google.maps.MapTypeId && google.maps.MapTypeId.HYBRID) ? google.maps.MapTypeId.HYBRID : 'hybrid';
            const map=new google.maps.Map($id("map"),{center:{lat:lati,lng:longi},zoom:zoomin,mapTypeId:mapTypeIdVal, tilt:0, gestureHandling: "cooperative", scrollwheel: true, clickableIcons: false});
                (function enableSmoothCtrlWheelZoom(map){
       const div = map.getDiv();
   
       // Lightweight overlay just to access the projection
       const projHelper = new google.maps.OverlayView();
       projHelper.onAdd = function() {};
       projHelper.draw = function() {};
       projHelper.onRemove = function() {};
       projHelper.setMap(map);
    
       let ticking = false;
       let queuedDelta = 0;
       let lastMouse = null; // keep last mouse position for anchor
    
       function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
    
       function applyZoom(){
         ticking = false;
         if (!queuedDelta || !lastMouse) { queuedDelta = 0; return; }
    
         const oldZ = map.getZoom() || 0;
         const newZ = clamp(oldZ + queuedDelta, 0, 23);
         queuedDelta = 0;
         if (newZ === oldZ) return;
    
         const proj = projHelper.getProjection();
         if (!proj) { map.setZoom(newZ); return; }
    
         const r  = div.getBoundingClientRect();
         const pt = new google.maps.Point(lastMouse.x - r.left, lastMouse.y - r.top);
         const before = proj.fromDivPixelToLatLng(pt);
    
         map.setZoom(newZ);
    
         const after = proj.fromDivPixelToLatLng(pt);
         const c = map.getCenter();
         map.setCenter(new google.maps.LatLng(
           c.lat() + (before.lat() - after.lat()),
           c.lng() + (before.lng() - after.lng())
         ));
       }
    
       div.addEventListener('wheel', function(ev){
         // Only take over when Ctrl/⌘ is down (keeps page scroll natural otherwise)
         if (!(ev.ctrlKey || ev.metaKey)) return;
    
         // Prevent both the page AND Google Maps’ own wheel handlers
         ev.preventDefault();
         ev.stopPropagation();
         if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    
         lastMouse = { x: ev.clientX, y: ev.clientY };
    
         // Convert deltaY to discrete zoom steps, with magnitude sensitivity
         // Typical mouse wheel notch ~120; trackpads produce smaller deltas
         const mag = Math.abs(ev.deltaY);
         const step = (ev.deltaY < 0 ? +1 : -1) * (mag >= 240 ? 3 : mag >= 120 ? 2 : 1);
    
         queuedDelta += step;
         if (!ticking){
           ticking = true;
           requestAnimationFrame(applyZoom);
         }
       }, { passive: false, capture: true }); // capture to beat Maps’ own handler
     })(map);


            const Draw = (function(){
        let map = null;
        let mode = null;              // 'polygon' | 'rectangle' | 'circle' | 'marker' | null
        let isDragging = false;

        // temp overlays while drawing
        let tmpLine = null;           // for polygon preview (Polyline)
        let tmpRect = null;
        let tmpCirc = null;
        let startLatLng = null;

        // listeners we own
        let L = [];

        // Pixel distance helper (used to detect click-near-start if you want it later)
        function distanceMeters(a,b){
            const A = new google.maps.LatLng(a.lat(), a.lng());
            const B = new google.maps.LatLng(b.lat(), b.lng());
            return google.maps.geometry.spherical.computeDistanceBetween(A,B);
        }

        function setMapDraggable(on){ map.setOptions({draggable: !!on}); }

        function clearTemp(){
            tmpLine?.setMap(null); tmpLine=null;
            tmpRect?.setMap(null); tmpRect=null;
            tmpCirc?.setMap(null); tmpCirc=null;
            startLatLng=null; isDragging=false;
        }

        function reset(){
            clearTemp();
            mode = null;
            setMapDraggable(true);
        }

        function bind(){
            unbind();
            L.push(map.addListener("click",     onClick));
            L.push(map.addListener("dblclick",  onDblClick));
            L.push(map.addListener("mousedown", onMouseDown));
            L.push(map.addListener("mousemove", onMouseMove));
            L.push(map.addListener("mouseup",   onMouseUp));
            const onDocUp = (ev)=>{ if (isDragging) onMouseUp(ev); };
            document.addEventListener("mouseup", onDocUp);
            L.push({ __dom:true, type:"mouseup", handler:onDocUp });
        }
        function unbind(){
            L.forEach(h=>{
                if (h && h.__dom) document.removeEventListener(h.type, h.handler);
                else google.maps.event.removeListener(h);
            });
            L = [];
        }

        function ensurePolyline(){
            if (tmpLine) return tmpLine;
            tmpLine = new google.maps.Polyline({
                map, strokeColor: "#0d6efd", strokeOpacity: 0.95, strokeWeight: 2, clickable:false
            });
            return tmpLine;
        }

            // Inside Draw.finishPolygon() – REPLACE the function body with:
        function finishPolygon(){
        if (!tmpLine) return;
        const path = tmpLine.getPath();
        if (path.getLength() < 3){ clearTemp(); return; }

        // Build a final editable, styled polygon (filled & clickable)
        const pts = []; for(let i=0;i<path.getLength();i++) pts.push(path.getAt(i));
        const poly = new google.maps.Polygon({
            map,
            paths: pts,
            editable: true,
            draggable: true,
            clickable: true,
            strokeColor: "#0d6efd",
            strokeOpacity: .95,
            strokeWeight: 2,
            fillColor: "#0d6efd",
            fillOpacity: .08
        });
        poly.wmType = "polygon";
        hookChangeListeners(poly);
        attachShapeClick(storedMap, poly);
        poly.__wmBound = true; 
        (storedMap.polygons||(storedMap.polygons=[])).push(poly);
        writeHiddenFromShape(poly);

        // History (reference‑based, as you have elsewhere)
        History.record({
            undo: ()=>{ removeShapeFromStore(poly); updateGenerateAvailability(); },
            redo: ()=>{ addShapeToStore(poly); }
        });

        window.selectedShape = poly;
        $id("submitbtn").disabled = false;
        updateGenerateAvailability();

        clearTemp();
        setMapDraggable(true);
        mode = null;
        $id("btnPoly")?.classList.remove("active");
        applyMapCursor(null);
            if (storedMap && storedMap.setOptions) {
              storedMap.setOptions({ draggableCursor: null, draggingCursor: null });
            }
        Tabs.bounceBackIfOnDownload();
    }


        function finishRectangle(){
            if (!tmpRect) return;
            tmpRect.setEditable(true);
            tmpRect.setDraggable(true);
            tmpRect.wmType = "rectangle";
            tmpRect.setOptions({ clickable: true }); // <-- enable for post-draw interactions
            hookChangeListeners(tmpRect);
            attachShapeClick(storedMap, tmpRect);
            tmpRect.__wmBound = true;
            (storedMap.rectangles||(storedMap.rectangles=[])).push(tmpRect);
            writeHiddenFromShape(tmpRect);

            const ref = tmpRect;
            History.record({
                undo: ()=>{ removeShapeFromStore(ref); updateGenerateAvailability(); },
                redo: ()=>{ addShapeToStore(ref); }
            });

            window.selectedShape = ref;
            $id("submitbtn").disabled = false;
            updateGenerateAvailability();

            tmpRect = null;
            setMapDraggable(true);
            mode = null;
            $id("btnRect")?.classList.remove("active");
            applyMapCursor(null);
            if (storedMap && storedMap.setOptions) {
              storedMap.setOptions({ draggableCursor: null, draggingCursor: null });
            }
                Tabs.bounceBackIfOnDownload();
        }

        function finishCircle(){
            if (!tmpCirc) return;
            tmpCirc.setEditable(true);
            tmpCirc.setDraggable(true);
            tmpCirc.wmType = "circle";
            tmpCirc.setOptions({ clickable: true }); // <-- enable for post-draw interactions
            hookChangeListeners(tmpCirc);
            attachShapeClick(storedMap, tmpCirc);
            tmpCirc.__wmBound = true;
            (storedMap.circles||(storedMap.circles=[])).push(tmpCirc);
            writeHiddenFromShape(tmpCirc);

            const ref = tmpCirc;
            History.record({
                undo: ()=>{ removeShapeFromStore(ref); updateGenerateAvailability(); },
                redo: ()=>{ addShapeToStore(ref); }
            });

            window.selectedShape = ref;
            $id("submitbtn").disabled = false;
            updateGenerateAvailability();

            tmpCirc = null;
            setMapDraggable(true);
            mode = null;
            $id("btnCirc")?.classList.remove("active");
            applyMapCursor(null);
            if (storedMap && storedMap.setOptions) {
              storedMap.setOptions({ draggableCursor: null, draggingCursor: null });
            }
            Tabs.bounceBackIfOnDownload();
        }

        /* --- Event handlers --- */
        function onClick(e){
            if (!mode) return;

            // Don’t conflict with your Ctrl+Shift rectangle multi-select
            if (e.domEvent && (e.domEvent.ctrlKey || e.domEvent.metaKey) && e.domEvent.shiftKey) return;


        if (mode === "marker"){
            // Drop waypoint and keep mode = 'marker' for repeated drops
            const m = createWaypointMarker(e.latLng, { heading: 0 });
            updatePreviousHeadingFromNew(m); // NEW: align previous heading to face this waypoint
            updateExportAvailability(); redrawFlightPaths(true); updateETA();
            updateWaypointCountWarnings(); updatePhotoCadenceWarning();
            return;
        }

    // Inside Draw.onClick(e) – in the "if (mode === 'polygon')" block,
    // INSERT this near‑start detection BEFORE the "first anchor / else" logic:

        if (mode === "polygon"){
            const line = ensurePolyline();
            const path = line.getPath();

            // NEW: If user clicks near the first point (<= ~15 m), finish the polygon
            if (path.getLength() >= 3) {
                const first = path.getAt(0);
                try {
                    const close = google.maps.geometry.spherical
                        .computeDistanceBetween(e.latLng, first) < 15;
                    if (close){
                        // snap trailing cursor to first point and finish
                        path.setAt(path.getLength()-1, first);
                        finishPolygon();
                        return;
                    }
                } catch {}
            }

            if (path.getLength() === 0){
                // first anchor + a “cursor” point we’ll update on mousemove
                path.push(e.latLng);
                path.push(e.latLng);
                setMapDraggable(false);
            } else {
                // commit current cursor position as anchor; leave a new cursor placeholder
                const last = path.getAt(path.getLength()-1);
                path.setAt(path.getLength()-1, e.latLng); // commit cursor to anchor
                path.push(last);                            // keep trailing cursor slot
            }
            return;
        }

        }

        function onDblClick(e){
            if (mode === "polygon"){
                stopDom(e);
                // remove trailing cursor point before finishing
                if (tmpLine){
                    const path = tmpLine.getPath();
                    if (path.getLength() >= 3){
                        path.removeAt(path.getLength()-1);
                    }
                }
                finishPolygon();
            }
        }

        function onMouseDown(e){
          if (!mode || mode === "polygon" || mode === "marker") return;

          // Only ignore a *non-left* mouse button when the property exists.
          const de = e.domEvent;
          if (de && typeof de.button === "number" && de.button !== 0) return;

          // FIX: clear temp *first* so we don't wipe startLatLng/isDragging.
          clearTemp();

          isDragging  = true;
          startLatLng = e.latLng;
          setMapDraggable(false);

            if (mode === "rectangle") {
              tmpRect = new google.maps.Rectangle({
                map,
                clickable: false,            // <-- was true
                editable: false,
                draggable: false,
                strokeColor: "#0d6efd",
                strokeOpacity: .95,
                strokeWeight: 2,
                fillColor: "#0d6efd",
                fillOpacity: .08,
                bounds: new google.maps.LatLngBounds(startLatLng, startLatLng)
              });
            } else if (mode === "circle") {
              tmpCirc = new google.maps.Circle({
                map,
                clickable: false,            // <-- was true
                editable: false,
                draggable: false,
                strokeColor: "#0d6efd",
                strokeOpacity: .95,
                strokeWeight: 2,
                fillColor: "#0d6efd",
                fillOpacity: .08,
                center: startLatLng,
                radius: 0
              });
            }
        }

        function applyMapCursor(mode){
            const el = document.getElementById("map");
            if (!el) return;
            el.classList.remove("cursor-rect","cursor-circ","cursor-poly","cursor-mark");
            if (!mode) return;
            el.classList.add(
                mode==="rectangle" ? "cursor-rect" :
                mode==="circle"    ? "cursor-circ" :
                mode==="marker"    ? "cursor-mark" :
                                 "cursor-poly"
            );
        }

        function onMouseMove(e){
            if (!mode) return;

            if (mode === "polygon" && tmpLine){
                const path = tmpLine.getPath();
                if (path.getLength() >= 1){
                    path.setAt(path.getLength()-1, e.latLng);
                }
                return;
            }

            if (!isDragging || !startLatLng) return;

            if (mode === "rectangle" && tmpRect){
                const sw = new google.maps.LatLng(
                    Math.min(startLatLng.lat(), e.latLng.lat()),
                    Math.min(startLatLng.lng(), e.latLng.lng())
                );
                const ne = new google.maps.LatLng(
                    Math.max(startLatLng.lat(), e.latLng.lat()),
                    Math.max(startLatLng.lng(), e.latLng.lng())
                );
                tmpRect.setBounds(new google.maps.LatLngBounds(sw, ne));
            }

            if (mode === "circle" && tmpCirc){
                const r = google.maps.geometry.spherical.computeDistanceBetween(startLatLng, e.latLng);
                tmpCirc.setRadius(r);
            }
        }

        const MIN_RECT_DIAGONAL_M = 2;   // ~2 m diagonal min for rectangles
        const MIN_CIRC_RADIUS_M   = 1.5; // ~1.5 m radius min for circles

        function onMouseUp(e){
          if (!isDragging) return;
          isDragging = false;

          if (mode === "rectangle") {
            if (tmpRect) {
              const b = tmpRect.getBounds();
              if (b) {
                const diag = google.maps.geometry.spherical
                  .computeDistanceBetween(b.getSouthWest(), b.getNorthEast());
                if (diag < MIN_RECT_DIAGONAL_M) {
                  // Too small: discard and keep drawing mode active
                  tmpRect.setMap(null);
                  tmpRect = null;
                  setMapDraggable(true);
                  return;
                }
              }
            }
            finishRectangle();
          }

          if (mode === "circle") {
            if (tmpCirc && tmpCirc.getRadius() < MIN_CIRC_RADIUS_M) {
              // Too small: discard and keep drawing mode active
              tmpCirc.setMap(null);
              tmpCirc = null;
              setMapDraggable(true);
              return;
            }
            finishCircle();
          }
        }

        window.applyMapCursor = applyMapCursor;

        /* --- Public API --- */
        return {
            init(m){ map = m; bind(); },
            setMode(m){
                if (mode === m) return;
                clearTemp();
                mode = m;
                setMapDraggable(!m || m === "marker");
                applyMapCursor(m);
                if (m === 'marker') {
                // Jump to Advanced and enter Single-waypoint mode
                showTabByButtonId('tab-settings-tab');
                setWaypointSettingsMode(true);
              } else {
                // Leaving the waypoint tool → restore normal view
               setWaypointSettingsMode(false);
              }
              // Re-evaluate lock/veil with the new mode
              updateAdvancedSettingsAvailability();
              },
            cancel(){ reset();applyMapCursor(null);  
            setWaypointSettingsMode(false);
            updateAdvancedSettingsAvailability();
            }
        };
    })();
        
        window.Draw = Draw;

            initDrawToolbar();
            Draw.init(map);
            window.map=map;
                // Mac: disable ctrl+click context menu only on the map
            if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)) {
              map.getDiv().addEventListener('contextmenu', (ev) => {
                if (ev.ctrlKey) ev.preventDefault();
              }, { passive: false });
            }
            storedMap=map;
            storedMap._userInteracted = false;
            storedMap._geocentered    = (hasGeo == 1);
            map.addListener("dragstart", ()=> storedMap._userInteracted = true);
            map.addListener("zoom_changed", ()=> storedMap._userInteracted = true);
            map.infoWindow=new google.maps.InfoWindow({content:"message"});
            map.rectangles=[]; map.circles=[]; map.polygons=[]; map.flags=[]; map.lines=[]; map.curvedPreview=[];
            // If we already have a fix at boot, apply it via the helper (keeps code centralized)
            if (hasGeo == 1) applyGeolocationToMap(position, { recenter: true });

            // Search
            const input = $id("pac-input");
            const searchBox = new google.maps.places.SearchBox(input);

            // Bias results to current viewport (standard SearchBox pattern)
            map.addListener("bounds_changed", () => searchBox.setBounds(map.getBounds()));

            let searchMarker = null;
            function dropSearchMarker(pos, title) {
              if (searchMarker) searchMarker.setMap(null);
              searchMarker = new google.maps.Marker({ map, position: pos, title });
            }

            // --- simple coord parser: "lat, lng", "lat lng", or with N/S/E/W
            function parseLatLngText(text) {
              if (!text) return null;
              let s = text.trim()
                .replace(/\s+/g, " ")         // collapse spaces
                .replace(/[°′’”"]/g, "");     // strip degree/quote symbols (basic)

              // split on comma or space
              let parts = s.includes(",") ? s.split(",") : s.split(" ");
              parts = parts.map(p => p.trim()).filter(Boolean);
              if (parts.length < 2) return null;

              function parseOne(tok, isLatGuess) {
                let sign = 1;
                // hemisphere suffix or prefix
                const hemi = tok.match(/[NnSsEeWw]/g) || [];
                if (hemi.some(h => /[SsWw]/.test(h))) sign = -1;
                // strip letters and keep number+sign
                tok = tok.replace(/[^\d.+-]/g, "");
                if (!tok) return null;
                let val = parseFloat(tok);
                if (Number.isNaN(val)) return null;
                val *= sign;

                // range check (lat first by default)
                if (isLatGuess && Math.abs(val) > 90) return null;
                if (!isLatGuess && Math.abs(val) > 180) return null;
                return val;
              }

              // try as lat, lng
              let lat = parseOne(parts[0], true);
              let lng = parseOne(parts[1], false);

              // if looks swapped (first looks like lng, second like lat), swap
              if ((lat === null || Math.abs(lat) > 90) && (lng !== null && Math.abs(lng) <= 90)) {
                const a = lat; lat = lng; lng = a;
              }

              if (lat === null || lng === null) return null;
              if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

              return { lat, lng };
            }

            function flyToLatLng(lat, lng, zoom = 17) {
              const pos = new google.maps.LatLng(lat, lng);
              map.setCenter(pos);
              if (zoom) map.setZoom(zoom);
              dropSearchMarker(pos, `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            }

            // Try coordinates when user presses Enter (even if Places has no result)
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") {
                // Let SearchBox do its thing first; if it doesn't find anything, we’ll fallback shortly after
                setTimeout(() => {
                  const places = searchBox.getPlaces && (searchBox.getPlaces() || []);
                  if (!places || !places.length) {
                    const ll = parseLatLngText(input.value);
                    if (ll) {
                      e.preventDefault();
                      flyToLatLng(ll.lat, ll.lng, 17);
                    }
                  }
                }, 0);
              }
            });

            // Normal Places flow; if empty, fallback to coordinates
            searchBox.addListener("places_changed", () => {
              const places = searchBox.getPlaces() || [];
              if (!places.length) {
                const ll = parseLatLngText(input.value);
                if (ll) flyToLatLng(ll.lat, ll.lng, 17);
                return;
              }

              const bounds = new google.maps.LatLngBounds();
              places.forEach((place) => {
                if (!place.geometry || !place.geometry.location) return;
                dropSearchMarker(place.geometry.location, place.name || input.value);
                if (place.geometry.viewport) bounds.union(place.geometry.viewport);
                else bounds.extend(place.geometry.location);
              });
              map.fitBounds(bounds);
            });

            // Click map: close info + clear selection
            map.addListener("click",()=>{
                map.infoWindow.close();
                window.selectedShape=null;
                if (Selection.size > 0){
                    const before = selectionIds();
                    applySelectionByIds([]);
                    History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds([]) });
                }
            });

    /* ---------- Lightweight drawing controller (no DrawingManager) ---------- */
    function initDrawToolbar() {
        const btnPoly  = $id("btnPoly");
        const btnRect  = $id("btnRect");
        const btnCirc  = $id("btnCirc");
        const btnMark  = $id("btnMark");
        const btnCancel= $id("btnCancel");
        const allBtns  = [btnPoly, btnRect, btnCirc, btnMark];

        function setActive(el){
            allBtns.forEach(b=>b?.classList.remove("active"));
            el?.classList.add("active");
        }

        btnPoly?.addEventListener("click", ()=>{ Draw.setMode("polygon"); setActive(btnPoly); });
        btnRect?.addEventListener("click", ()=>{ Draw.setMode("rectangle"); setActive(btnRect); });
        btnCirc?.addEventListener("click", ()=>{ Draw.setMode("circle"); setActive(btnCirc); });
        btnMark?.addEventListener("click", ()=>{ Draw.setMode("marker"); setActive(btnMark); });
        btnCancel?.addEventListener("click", ()=>{ window.Draw?.cancel(); setActive(null); });

        // ESC cancels current drawing
        document.addEventListener("keydown", (e)=>{
          if (e.key === "Escape" || e.key === "Esc"){
            endTransform();                      // <-- NEW: exit transform mode
            window.Draw?.cancel(); setActive(null);
            applyMapCursor(null);
            storedMap?.setOptions?.({ draggable: true, draggableCursor: null, draggingCursor: null });
          }
        });
    }

    // Tiny helper to stop native zoom on dblclick while we’re drawing
    function stopDom(e){
        try{
            e?.domEvent?.preventDefault?.(); e?.domEvent?.stopPropagation?.();
            e?.stop?.();
        }catch{}
    }




            // Ctrl+Shift+Drag rectangle group-selection
            let dragSelecting=false, dragRect=null, dragStart=null;
            map.addEventListener?.("mousedown",()=>{});
            map.addListener("mousedown",(e)=>{
                const dom = e.domEvent || e;
                if(!(dom && modHeld(dom) && dom.shiftKey)) return;

                window.Draw?.cancel();
                applyMapCursor(null);
                storedMap?.setOptions?.({ draggable: true, draggableCursor: null, draggingCursor: null });
                $id("btnSelect")?.classList.add("active");

                dom.preventDefault();

                dom.preventDefault();
                dragSelecting = true;
                map.setOptions({draggable:false});
                dragStart = e.latLng;
                dragRect = new google.maps.Rectangle({
                    map,
                    clickable:false,
                    strokeColor:"#0d6efd",
                    strokeOpacity:0.9,
                    strokeWeight:1,
                    fillColor:"#0d6efd",
                    fillOpacity:0.08,
                    bounds: new google.maps.LatLngBounds(dragStart, dragStart)
                });
            });
            map.addListener("mousemove",(e)=>{
                lastMouseLatLng = e.latLng;
                if(!dragSelecting || !dragRect) return;
                const sw = new google.maps.LatLng(Math.min(dragStart.lat(), e.latLng.lat()), Math.min(dragStart.lng(), e.latLng.lng()));
                const ne = new google.maps.LatLng(Math.max(dragStart.lat(), e.latLng.lat()), Math.max(dragStart.lng(), e.latLng.lng()));
                dragRect.setBounds(new google.maps.LatLngBounds(sw, ne));
            });
            function finishDragSelect(){
                if(!dragSelecting) return;
                dragSelecting=false;
                map.setOptions({draggable:true});
                const rect=dragRect; dragRect=null;
                if(!rect) return;
                const b=rect.getBounds(); rect.setMap(null);
                const before = selectionIds();
                const added = [];
                (storedMap?.flags||[]).forEach(m=>{
                    const ll=new google.maps.LatLng(m.lat,m.lng);
                    if (b.contains(ll)) added.push(m.id);
                });
                const after = Array.from(new Set([...before, ...added])).sort((a,b)=>a-b);
                applySelectionByIds(after);
                History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds(after) });
            }
            map.addListener("mouseup", finishDragSelect);
            document.addEventListener("mouseup", finishDragSelect);

            // Pre‑loaded waypoints (server Model)

            updateGenerateAvailability(); updateUndoRedoButtons(); labelUnits(); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
            setTimeout(()=>{ if (Onboard && typeof Onboard.maybeStart === "function") Onboard.maybeStart(); }, 400);
        }
        window.initMap = maybeInitMap;

        /* ---------- Export UI ---------- */
        function updateExportControls(){
          // Non-Premium: split always hidden
          const split = $id("splitToggle").checked;
          const mode  = ($id("splitMode")?.value || "battery");

              $id("splitZipWrap")?.classList.toggle("hide", !split);

          if(!IS_PREMIUM){
            $id("splitToggle").checked = false;
            $id("splitOptions")?.classList.add("hide");
            $id("splitDownloadBtn")?.classList.toggle("hide", !split);
            $id("downloadWrap")?.classList.toggle("hide", split);
            // Re-evaluate the warning using actual waypoint count
            updateWaypointCountWarnings();
            updateEmptyDownloadVeils();
            return;
          }

          // Show/hide split options
          $id("splitOptions")?.classList.toggle("hide", !split);

          // Per-mode rows
          $id("batteryRow")?.classList.toggle("hide", !(split && mode==="battery"));
          $id("wpRow")?.classList.toggle("hide", !(split && mode==="waypoints"));

          // Button visibility
          $id("splitDownloadBtn")?.classList.toggle("hide", !split);
          $id("downloadBtn")?.classList.toggle("hide", split);

          updateEmptyDownloadVeils();

          // Correct handling of the >100 WP warning
          if (split) {
            $id("wpCountNote")?.classList.add("hide");
          } else {
            updateWaypointCountWarnings();
          }
        }
        if ($id("splitToggle")) $id("splitToggle").addEventListener("change", ()=>{ updateExportControls(); updateWaypointCountWarnings(); });

        var downloadButton=document.getElementsByName("DownloadKMZ");
        if(downloadButton && downloadButton[0]){
            downloadButton[0].addEventListener("mouseover", function(){
                var saveField=document.getElementsByName("missionName");
                if(saveField && saveField[0]) saveField[0].value="";
            }, false);
        }

        // Split & ZIP (Premium)
            if ($id("splitDownloadBtn")) $id("splitDownloadBtn")?.addEventListener("click", async function(){
              if(!IS_PREMIUM){ alert("Split is a Premium feature."); return; }

              const mode = $id("splitMode")?.value || "battery";
              let segments = [];

              if (mode === "battery"){
                const mins = parseFloat($id("batteryMinutes")?.value || "20") || 20;
                segments = computeSegmentsByBattery(mins*60);
              } else {
                const max = Math.max(20, parseInt($id("maxWaypoints")?.value || "100", 10) || 100);
                segments = computeSegmentsByWaypoint(max);
              }

              if (segments.length <= 1){
                alert("Mission already fits in one segment based on your settings.");
                return;
              }

              const payload = {
            finalAction: parseInt($id("finalAction").value||"0",10),
            // Be explicit: we’re sending metric numbers now
            unitType: 0,
            segments: segments.map(seg => seg.map(markerToServerPoint))
              };

              const res = await fetch("/Home/DownloadSplit", {
                method:"POST",
                headers:{ "Content-Type":"application/json" },
                body: JSON.stringify(payload)
              });

              if(!res.ok){ const t=await res.text(); console.error(t); alert("Split download failed."); return; }
              const blob = await res.blob(); const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "WaypointMap_Segments.zip";
              document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            });

        function computeSegmentsByBattery(batterySeconds){
            const flags=(storedMap?.flags||[]).slice().sort((a,b)=>a.id-b.id);
            if (flags.length < 2) return [flags];
            const segments=[]; let current=[]; let t=0;
            function pairTime(a,b){
                const d=haversine({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng});
                const spdMps = (unitMode ? ((a.speed+b.speed)/2/M2FT) : ((a.speed+b.speed)/2));
                return (spdMps>0) ? (d/spdMps) : 0;
            }
            for(let i=0;i<flags.length;i++){
                if(current.length===0){ current.push(flags[i]); continue; }
                const nextT = t + pairTime(current[current.length-1], flags[i]) + 0.8;
                if(nextT > batterySeconds && current.length>1){
                    segments.push(current.slice());
                    current=[flags[i-1], flags[i]];
                    t = pairTime(flags[i-1], flags[i]) + 0.8;
                }else{
                    current.push(flags[i]); t = nextT;
                }
            }
            if(current.length) segments.push(current);
            return segments;
        }

        function computeSegmentsByWaypoint(maxPerSegment){
              const flags=(storedMap?.flags||[]).slice().sort((a,b)=>a.id-b.id);
              if (flags.length <= maxPerSegment) return [flags];

              const out=[];
              let cur=[];

              for(let i=0;i<flags.length;i++){
                // start a new segment or continue
                if (cur.length===0) {
                  cur.push(flags[i]);
                  continue;
                }
                cur.push(flags[i]);

                if (cur.length >= maxPerSegment && i < flags.length-1) {
                  // close current, start next with boundary continuity
                  out.push(cur.slice());
                  cur = [flags[i]]; // share boundary point
                }
              }
              if (cur.length) out.push(cur);
              return out;
        }

        /* ---------- Settings search ---------- */
        (function initSettingsSearch(){
            const input = $id("settingsSearch");
            if (!input) return;

            const pairs = [
                { attr: "basics",   collapseId: "fs-basic" },
                { attr: "coverage", collapseId: "fs-coverage" },
                { attr: "camera",   collapseId: "fs-camera" },
                { attr: "advanced", collapseId: "fs-advanced" }
            ];

            function defaultOpen(){
                new bootstrap.Collapse($id("fs-basic"), {toggle:false}).show();
                ["fs-coverage","fs-camera","fs-advanced"].forEach(id => new bootstrap.Collapse($id(id), {toggle:false}).hide());
            }

            input.addEventListener("input", function(){
                const q = (this.value || "").trim().toLowerCase();
                document.querySelectorAll("#tab-settings [data-name]").forEach(x=>x.classList.remove("search-hit"));
                if (!q){ defaultOpen(); return; }
                let anyOpened = false;
                pairs.forEach(p=>{
                    const item = document.querySelector(`[data-section='${p.attr}']`);
                    let any = false;
                    item?.querySelectorAll?.("[data-name]")?.forEach(group=>{
                        const txt = group.textContent.toLowerCase();
                        if (txt.includes(q)){ any = true; group.classList.add("search-hit"); }
                    });
                    const col = new bootstrap.Collapse($id(p.collapseId), {toggle:false});
                    if (any){ col.show(); anyOpened = true; } else { col.hide(); }
                });
                if (!anyOpened) new bootstrap.Collapse($id("fs-basic"), {toggle:false}).show();
            });
        })();

        /* ---------- Presets ---------- */
        const PRESETS_KEY = "wm_presets_v1";
        const PRESET_DEFAULT_KEY = "wm_preset_default";
        const SLIDER_ID = "__slider__";
        function getPresets(){ try{ return JSON.parse(localStorage.getItem(PRESETS_KEY)||"[]"); }catch{ return []; } }
        function savePresets(arr){ localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); }
        function getDefaultPreset(){ return localStorage.getItem(PRESET_DEFAULT_KEY)||SLIDER_ID; }
        function setDefaultPreset(name){ localStorage.setItem(PRESET_DEFAULT_KEY, name||SLIDER_ID); }

        function readSettings(){
            return {
                unitType: ($id("in_units").value||"0"),
                altitude: $id("altitude").value, speed:$id("speed").value,
                in_distance:$id("in_distance")?.value, in_overlap:$id("in_overlap")?.value, in_interval:$id("in_interval")?.value,
                in_lineOrientation:$id("in_lineOrientation")?.value, in_flipPath:$id("in_flipPath")?.checked||false,
                angle:$id("angle").value, in_allPointsAction:$id("in_allPointsAction")?.value||"noAction",
                maintainAlt:$id("maintainAlt")?.checked||false, in_straightenLines:$id("in_straightenLines")?.checked||false,
                in_generateAllPoints:$id("in_generateAllPoints")?.checked||false,
                in_turnMode:$id("in_turnMode")?.value||"",
                // NEW: line angle fields
                in_lineAngleMode:$id("in_lineAngleMode")?.value||"preset",
                in_lineAngleDegrees:$id("in_lineAngleDegrees")?.value||"0"
            };
        }
        function applySettings(s){
            const prevUnit = unitMode; // <-- capture current units BEFORE changes
            suppressUnitsChange = true;
            $id("in_units").value = String(s.unitType||"0");
            unitMode = parseInt($id("in_units").value,10)||0;
            labelUnits();
            suppressUnitsChange = false;

            $id("altitude").value = s.altitude; $id("speed").value=s.speed;
            if($id("in_distance") && s.in_distance!=null) $id("in_distance").value=s.in_distance;
            if($id("in_overlap") && s.in_overlap!=null) $id("in_overlap").value=s.in_overlap;
            if($id("in_interval") && s.in_interval!=null) $id("in_interval").value=s.in_interval;

            if($id("in_lineOrientation") && s.in_lineOrientation!=null) $id("in_lineOrientation").value = s.in_lineOrientation;
            if($id("angle")) $id("angle").value = s.angle;
            if($id("in_allPointsAction")) $id("in_allPointsAction").value = s.in_allPointsAction;

            if($id("in_flipPath")) $id("in_flipPath").checked = !!s.in_flipPath;
            if($id("maintainAlt") && !$id("maintainAlt").disabled) $id("maintainAlt").checked = !!s.maintainAlt;
            if($id("in_straightenLines") && !$id("in_straightenLines").disabled) $id("in_straightenLines").checked = !!s.in_straightenLines;
            if($id("in_generateAllPoints") && !$id("in_generateAllPoints").disabled){
                $id("in_generateAllPoints").checked = !!s.in_generateAllPoints;
                if($id("interval_div")){ $id("interval_div").hidden = !!s.in_generateAllPoints; }
                intervalSeen = !!s.in_generateAllPoints;
            }
            if($id("in_turnMode")) $id("in_turnMode").value = s.in_turnMode || "";

            if($id("in_lineAngleMode")) $id("in_lineAngleMode").value = s.in_lineAngleMode || "preset";
            if($id("in_lineAngleDegrees")) $id("in_lineAngleDegrees").value = s.in_lineAngleDegrees || "0";

            updateIntervalOverlap(); updateOverlap(); updateETA();

              // If preset switched unit systems, rebase existing waypoints to match
              if (prevUnit !== unitMode){
                const f = unitMode ? M2FT : (1 / M2FT);
                convertAllWaypointValues(f);
                refreshActiveInfoWindow();
              }
        }

        function refreshPresetSelect(){
            const select=$id("presetSelect"); if(!select) return;
            const presets=getPresets();
            let def=getDefaultPreset();

            const wrap = $id("presetChooserWrap");
            const showChooser = IS_PREMIUM && presets.length >= 1;
            if (wrap) wrap.classList.toggle("hide", !showChooser);

            select.innerHTML="";
            const opt0=document.createElement("option"); opt0.value=SLIDER_ID; opt0.textContent="Slider (manual)"; select.appendChild(opt0);
            presets.forEach(p=>{
                const o=document.createElement("option");
                o.value=p.name; o.textContent=p.name + (def===p.name ? " (Default)" : "");
                select.appendChild(o);
            });

            if(!IS_PREMIUM){ def = SLIDER_ID; }

            select.value = (def && (def===SLIDER_ID || presets.some(p=>p.name===def))) ? def : SLIDER_ID;
            handlePresetSelectionChange();
        }
        function handlePresetSelectionChange(){
            const val=$id("presetSelect").value;
            if(IS_PREMIUM && val!==SLIDER_ID){
                const p = getPresets().find(x=>x.name===val);
                if(p){ applySettings(p.values); }
            }
            updateQualitySliderAvailability();
        }
        $id("presetSelect")?.addEventListener("change", handlePresetSelectionChange);
        $id("presetDefaultBtn")?.addEventListener("click", ()=>{ if(!IS_PREMIUM) return; const sel=$id("presetSelect").value; setDefaultPreset(sel); refreshPresetSelect(); });
        $id("presetDeleteBtn")?.addEventListener("click", ()=>{
            if(!IS_PREMIUM) return;
            const sel=$id("presetSelect").value; if(sel===SLIDER_ID) return;
            if(!confirm(`Delete preset "${sel}"?`)) return;
            let arr=getPresets().filter(p=>p.name!==sel); savePresets(arr);
            if(getDefaultPreset()===sel) setDefaultPreset(SLIDER_ID);
            refreshPresetSelect();
        });
        $id("savePresetBtn")?.addEventListener("click", ()=>{
            if(!IS_PREMIUM) return;
            const name=($id("presetName").value||"").trim();
            if(!name){ alert("Please enter a preset name."); return; }
            const vals=readSettings();
            let arr=getPresets();
            const idx=arr.findIndex(p=>p.name.toLowerCase()===name.toLowerCase());
            if(idx>=0){
                if(!confirm(`Overwrite preset "${arr[idx].name}"?`)) return;
                arr[idx].values=vals;
            }else{
                arr.push({name, values:vals});
            }
            savePresets(arr); refreshPresetSelect(); $id("presetName").value="";
        });
        $id("splitToggle")?.addEventListener("change", updateExportControls);
        $id("splitMode")?.addEventListener("change", updateExportControls);
        $id("batteryMinutes")?.addEventListener("input", updateExportControls);
        $id("maxWaypoints")?.addEventListener("input", updateExportControls);

        const qualitySlider = $id("qualitySlider");
        const qualityValue  = $id("qualityValue");
        function applyPresetFromSlider(){
            const ov = parseInt(qualitySlider?.value || "80", 10);
            if (qualityValue) qualityValue.textContent = ov;
            const overlapEl = $id("in_overlap");
            if (overlapEl) {
                overlapEl.value = ov;
                if (typeof updateOverlap === "function") updateOverlap();
            }
        }
        qualitySlider?.addEventListener("input", applyPresetFromSlider);
        applyPresetFromSlider(); // initialize to 80
        refreshPresetSelect();

        /* ---------- Onboarding ---------- */
        Onboard = {
          active: false,
          step: 0,

          targets: {
            1: () => $id("map"),
            2: () => $id("presetGenBtn"),
            3: () => $id("downloadBtn")
          },

          texts: {
            1: { title: "Draw a shape", body: "Use the tools at the top of the map to draw a polygon, rectangle, or circle." },
            2: { title: "Generate flight path", body: "Click <b>Generate</b> in the Simple tab to create waypoints." },
            3: { title: "Download KMZ", body: "Open the Export tab and click <b>Download KMZ</b> to save your mission." }
          },

          maybeStart() {
            if (localStorage.getItem("wm_onboard_done") === "1") return;
            this.start();
          },

          start() {
            this.active = true;
            this.goto(1);
          },

          finish() {
            this.active = false;
            localStorage.setItem("wm_onboard_done", "1");

            const overlay = $id("onboard");
            overlay.classList.add("hidden");
            overlay.classList.remove("active");

            // remove any pulsing highlights
            ["presetGenBtn", "downloadBtn"].forEach(id => $id(id)?.classList.remove("pulse"));

            // clean positional listeners if scheduled
            if (this._unbind) { this._unbind(); this._unbind = null; }
          },

          goto(n) {
            const max = Object.keys(this.texts).length;
            if (n > max) { this.finish(); return; }

            this.step = n;

            const overlay = $id("onboard");
            overlay.classList.remove("hidden");
            overlay.classList.add("active");

            const card  = $id("onbCard");
            const title = $id("onbTitle");
            const body  = $id("onbBody");

            const t = this.texts[n];
            if (!t) { this.finish(); return; }

            title.textContent = t.title;
            body.innerHTML    = t.body;

            // tab & pulse hints
            ["presetGenBtn", "downloadBtn"].forEach(id => $id(id)?.classList.remove("pulse"));
            if (n === 2) { $id("tab-presets-tab")?.click();  $id("presetGenBtn")?.classList.add("pulse"); }
            if (n === 3) { $id("tab-export-tab")?.click();   $id("downloadBtn")?.classList.add("pulse"); }

            const target = (this.targets[n] && this.targets[n]()) || null;

            const place = () => {
             const r  = target?.getBoundingClientRect?.() || { top: 0, left: 0, width: 0, height: 0 };
             const cr = card.getBoundingClientRect();
             const pad = 12, vw = window.innerWidth, vh = window.innerHeight;
    
             // Use viewport coords for a fixed element (NO scroll offsets)
             let top  = r.top + r.height + pad;
             let left = r.left + r.width  + pad;
    
             // If the card would clip, flip above/left as needed
             if (top + cr.height > vh - pad)  top  = Math.max(pad, r.top - cr.height - pad);
             if (left + cr.width > vw - pad)  left = Math.max(pad, r.left - cr.width - pad);
    
             // If the target is off‑screen or hidden, center the card
             const targetVisible = r.width > 1 || r.height > 1;
             if (!targetVisible){
               top  = Math.max(pad, (vh - cr.height) / 2);
               left = Math.max(pad, (vw - cr.width) / 2);
             }

              card.style.top  = `${top}px`;
              card.style.left = `${left}px`;
            };

            // position now and shortly after layout settles
            if (n === 2) {
              const t = this.targets[n] && this.targets[n]();
              // Ensure the button is scrolled into view before we measure it
              try { t?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
            }
            place();
            requestAnimationFrame(place);
            setTimeout(place, 250);

            // keep near target on resize/scroll; tear down on next goto/finish
            const onWin = () => place();
            window.addEventListener("resize", onWin, { passive: true });
            window.addEventListener("scroll",  onWin, { passive: true });
            if (this._unbind) this._unbind();
            this._unbind = () => {
              window.removeEventListener("resize", onWin);
              window.removeEventListener("scroll", onWin);
            };
          }
        };

        // expose globally so button handlers can always call it
        window.Onboard = Onboard;

        // (re)wire the three buttons AFTER the object exists
        (function wireOnboardControls(){
          const next  = document.getElementById('onbNext');
          const skip  = document.getElementById('onbSkip');
          const close = document.getElementById('onbClose');
          const mask  = document.querySelector('#onboard .mask');

          next?.addEventListener('click',  () => window.Onboard.goto((window.Onboard.step || 1) + 1));
          skip?.addEventListener('click',  () => window.Onboard.finish());
          close?.addEventListener('click', () => window.Onboard.finish());
          mask?.addEventListener('click',  () => window.Onboard.finish());
        })();

           const Transform = {
      active: false,
      mode: null,                // 'rotate' | 'scale'
      center: null,              // { lat, lng, cosPhi }
      originals: null,           // snapshots (baseline for history)
      locals: null,              // [{ m, x, y, keep }]
      angle: 0,                  // degrees (live)
      scale: 1,
      _timer: null,
      commitDelay: 400
    };

    document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc'){
    e.preventDefault();
    e.stopPropagation();
    exitToNormalView();
  }
});

const HeadingTransform = {
  active: false,
  originals: null,      // baseline snapshots for history (per-gesture)
  locals: null,         // [{ m, keep }] where keep.heading is baseline
  angle: 0,             // live delta in degrees
  _timer: null,
  commitDelay: 400
};

function beginHeadingTransform(){
  const sel = Array.from(Selection);
  if (!sel.length) return;

  // End any geometry transform so modes don't clash
  try { endTransform(); } catch {}

  HeadingTransform.active   = true;
  HeadingTransform.originals= sel.map(snapMarker);
  HeadingTransform.locals   = sel.map(m => ({ m, keep: snapMarker(m) }));
  HeadingTransform.angle    = 0;
  const headInp = document.getElementById('headAngle');
  if (headInp) headInp.value = '0';
}

function _norm360(a){ a%=360; if(a<0) a+=360; return a; } // you already have this; keep one copy

function applyHeadingAngle(angleDeg){
  if (!HeadingTransform.active) beginHeadingTransform();
  HeadingTransform.angle = angleDeg;
// Reflect in UI unless the user is actively typing there
   const headInp = document.getElementById('headAngle');
   if (headInp && document.activeElement !== headInp){
     headInp.value = String(Math.round(angleDeg));
  }

  HeadingTransform.locals.forEach(o => {
    const base = (o.keep?.heading ?? 0);
    const h    = _norm360(base + angleDeg);
    o.m.heading = h;
    setMarkerRotation(o.m, h);   // your existing helper: sets icon.rotation = heading - 45
  });

  // No lat/lng change → redraw is optional, but harmless:
  redrawFlightPaths(true);
}

function rotateHeadingsOnlyBy(deltaDeg){
  if (!HeadingTransform.active) beginHeadingTransform();

  const next = (HeadingTransform.angle + deltaDeg);
  applyHeadingAngle(next);
  scheduleHeadingAutoCommit();
}

function scheduleHeadingAutoCommit(){
  clearTimeout(HeadingTransform._timer);
  HeadingTransform._timer = setTimeout(softCommitHeading, HeadingTransform.commitDelay);
}

// One history entry per “gesture” (like your geometry Transform does)
function softCommitHeading(){
  if (!HeadingTransform.active || !HeadingTransform.originals?.length) return;

  const ids   = HeadingTransform.originals.map(s => s.id);
  const marks = markersByIds(ids);
  const before= HeadingTransform.originals;
  const after = marks.map(snapMarker);

  History.record({
    undo: () => applySnapshots(marks, before),
    redo: () => applySnapshots(marks, after)
  });

  // Start next adjustments from here (prevents history spam)
  HeadingTransform.originals = after.map(s => ({ ...s }));
  HeadingTransform.locals    = marks.map(m => ({ m, keep: snapMarker(m) }));

   // CRITICAL: clear the running delta so next +/- is relative to new baseline
   HeadingTransform.angle = 0;
   const headInp = document.getElementById('headAngle');
   if (headInp) headInp.value = '0';
}

function endHeadingTransform(){
  if (!HeadingTransform.active) return;
  HeadingTransform.active    = false;
  HeadingTransform.originals = null;
  HeadingTransform.locals    = null;
  clearTimeout(HeadingTransform._timer);
  const headInp = document.getElementById('headAngle');
  if (headInp) headInp.value = '0';
}

    function exitToNormalView(){
      // end any live rotate/scale session
      try { endTransform(); } catch {}
      try { endHeadingTransform(); } catch {}

      // cancel any drawing tool + reset cursors
      window.Draw?.cancel?.();
      applyMapCursor(null);
      storedMap?.setOptions?.({ draggable: true, draggableCursor: null, draggingCursor: null });

      // clear selection (with undo)
      if (Selection?.size > 0){
        const before = selectionIds();
        applySelectionByIds([]); // updateSelectionUI() will flip panels
        History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds([]) });
      } else {
        // ensure panels are correct even if nothing was selected
        document.getElementById('folderPanel')?.classList.remove('hide');
        document.getElementById('multiPanel')?.classList.add('hide');
        document.getElementById('selectKeybinds')?.classList.add('hide');
      }

      // close any InfoWindow
      try { storedMap?.infoWindow?.close(); } catch {}
    }

    function _norm360(a){ a%=360; if(a<0)a+=360; return a; }

    function selectionCenter(){
      const sel = Array.from(Selection); if (!sel.length) return null;
      let sumLat=0, sumLng=0; sel.forEach(m => { sumLat+=m.lat; sumLng+=m.lng; });
      const lat0 = sumLat/sel.length, lng0 = sumLng/sel.length;
      return { lat: lat0, lng: lng0, cosPhi: Math.cos(lat0*Math.PI/180) };
    }

    function localsFromSelection(center){
      return Array.from(Selection).map(m => ({
        m,
        x: (m.lng - center.lng) * center.cosPhi,
        y: (m.lat - center.lat),
        keep: snapMarker(m)       // includes heading, etc.
      }));
    }

    function setMarkerLatLng(m, lat, lng){
      m.lat = lat; m.lng = lng;
      m.setPosition({ lat, lng });
    }
    // rotateHeadings: true only for rotate mode; keep headings for scale mode

    function applyTransform(locals, center, angleDeg, scale, rotateHeadings){
      // Use −angle so “[” (CCW) actually rotates the geometry CCW on the map
      const theta = -(angleDeg || 0) * Math.PI/180;
      const c = Math.cos(theta), s = Math.sin(theta);

      locals.forEach(o => {
        let x = o.x * scale, y = o.y * scale;

        // standard 2D rotation
        const xr = x*c - y*s;
        const yr = x*s + y*c;

        // back to lat/lng (equirectangular local frame)
        const newLng = center.lng + (xr / center.cosPhi);
        const newLat = center.lat + yr;
        setMarkerLatLng(o.m, newLat, newLng);

        // headings rotate with the geometry so relative headings stay the same
        if (rotateHeadings){
          const h0 = (o.keep?.heading ?? 0);
          o.m.heading = _norm360(h0 + angleDeg);   // same sign as theta above
          setMarkerRotation(o.m, o.m.heading);
        }
      });

      redrawFlightPaths(true);
      updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();
    }

    function beginTransform(mode){
      const sel = Array.from(Selection); if (!sel.length) return;
      if (HeadingTransform.active) endHeadingTransform(); // avoid overlapping modes
      Transform.active     = true;
      Transform.mode       = mode;
      Transform.center     = selectionCenter();
      Transform.originals  = sel.map(snapMarker);        // baseline for history
      Transform.locals     = localsFromSelection(Transform.center);
      Transform.angle      = 0;
      Transform.scale      = 1;
      if (mode === 'scale') {
        const scInp = document.getElementById('scaleFactor');
        if (scInp) scInp.value = '1.00';
      }
      const headInp = document.getElementById('headAngle');
      if (headInp) headInp.value = '0';
    }

    function scheduleAutoCommit(){
      clearTimeout(Transform._timer);
      Transform._timer = setTimeout(softCommitTransform, Transform.commitDelay);
    }

    // Record one history entry per "gesture" and keep the transform session alive
    function softCommitTransform(){
      if (!Transform.active || !Transform.originals?.length) return;

      const ids    = Transform.originals.map(s => s.id);
      const marks  = markersByIds(ids);
      const before = Transform.originals;
      const after  = marks.map(snapMarker);

      History.record({
        undo: () => applySnapshots(marks, before),
        redo: () => applySnapshots(marks, after)
      });

    // --- REBASE for the next increments (keep the same center to avoid re‑anchor jumps)
       Transform.originals = after.map(s => ({ ...s }));
       // Keep Transform.center as-is (we already transformed around this center)
       Transform.locals    = localsFromSelection(Transform.center);
       Transform.angle     = 0;
       Transform.scale     = 1;  // <-- critical: zero the live multiplier
      const inp = document.getElementById('rotAngle');
      if (inp) inp.value = '0';
      const sc  = document.getElementById('scaleFactor');
      if (sc) sc.value = '1.00';
    }

    // Optional: explicit finalize (not required anymore)
    function commitTransform(){
      softCommitTransform();
      endTransform();
    }

    function endTransform(){
       if (!Transform.active) return;
       Transform.active = false;
       Transform.mode = null;
       Transform.originals = null;
       Transform.locals = null;
       clearTimeout(Transform._timer);
       storedMap?.setOptions?.({ draggable:true });
    }

    function rotateSelBy(deltaDeg){
      if (!Transform.active || Transform.mode !== 'rotate') beginTransform('rotate');

      // Re-start if no session, wrong mode, or the cached baseline no longer matches current positions
      const stale =
        !Transform.active || Transform.mode !== 'rotate' ||
        !Transform.locals || Transform.locals.length !== Selection.size ||
        Transform.locals.some(o => o.keep.lat !== o.m.lat || o.keep.lng !== o.m.lng);
      if (stale) beginTransform('rotate');

      const inp = document.getElementById('rotAngle');
      const ui  = parseFloat(inp?.value || '0') || 0; // UI is canonical
      const next = ui + deltaDeg;

      Transform.angle = next;
      applyTransform(Transform.locals, Transform.center, Transform.angle, Transform.scale, /*rotateHeadings*/true);

      if (inp) inp.value = String(Math.round(next));
      scheduleAutoCommit();
    }

    function scaleSelBy(mult){
      if (!Transform.active || Transform.mode !== 'scale') beginTransform('scale');
      Transform.scale = Math.max(0.05, Math.min(10, Transform.scale * mult));
      applyTransform(Transform.locals, Transform.center, Transform.angle, Transform.scale, /*rotateHeadings*/false);
      const inp = document.getElementById('scaleFactor'); if (inp) inp.value = Transform.scale.toFixed(2);
      scheduleAutoCommit();
    }

    // --- Wire UI inputs (now auto-commit) ---
    document.getElementById('rotLeft5') ?.addEventListener('click',  () => rotateSelBy(-5));
    document.getElementById('rotRight5')?.addEventListener('click',  () => rotateSelBy(+5));
    document.getElementById('rotAngle') ?.addEventListener('input',  () => {
      const v = parseFloat(document.getElementById('rotAngle').value) || 0;
      if (!Transform.active || Transform.mode !== 'rotate') beginTransform('rotate');
      Transform.angle = v;
      applyTransform(Transform.locals, Transform.center, Transform.angle, Transform.scale, true);
      scheduleAutoCommit();
    });

    document.getElementById('headLeft5') ?.addEventListener('click', () => rotateHeadingsOnlyBy(-5));
    document.getElementById('headRight5')?.addEventListener('click', () => rotateHeadingsOnlyBy(+5));
    document.getElementById('headAngle') ?.addEventListener('input', () => {
      let v = parseFloat(document.getElementById('headAngle').value);
      if (!isFinite(v)) v = 0;
      if (!HeadingTransform.active) beginHeadingTransform();
      applyHeadingAngle(v);
      scheduleHeadingAutoCommit();
    });
    document.getElementById('scaleDown')  ?.addEventListener('click', () => scaleSelBy(0.90));
    document.getElementById('scaleUp')    ?.addEventListener('click', () => scaleSelBy(1.10));
    document.getElementById('scaleFactor')?.addEventListener('input', () => {
      let v = parseFloat(document.getElementById('scaleFactor').value);
      if (!isFinite(v) || v <= 0) v = 1;
      if (!Transform.active || Transform.mode !== 'scale') beginTransform('scale');
      Transform.scale = v;
      applyTransform(Transform.locals, Transform.center, Transform.angle, Transform.scale, false);
      scheduleAutoCommit();
    });

    // --- Keyboard: R/[ ] for rotate; S/−/+ for scale. No Enter needed anymore. Esc ends session. ---
    function typingInField(t){
      const tag = (t?.tagName||'').toLowerCase();
      return tag === 'input' || tag === 'textarea' || (t?.isContentEditable);
    }

    document.addEventListener('keydown', (e) => {
        // Let Esc / Enter pass even if an input has focus
        if (typingInField(e.target) && !(e.key === 'Escape' || e.key === 'Esc' || e.key === 'Enter')) return;

          if (e.key.toLowerCase() === 'h'){
            if (Selection.size === 0) return;
            e.preventDefault();
            beginHeadingTransform();
            return;
          }

          // While in heading-only mode, use [ / ] to change and Esc to end
          if (HeadingTransform.active){
            if (e.key === '['){ e.preventDefault(); rotateHeadingsOnlyBy(-5); return; }
            if (e.key === ']'){ e.preventDefault(); rotateHeadingsOnlyBy(+5); return; }
            if (e.key === 'Escape' || e.key === 'Esc'){ e.preventDefault(); endHeadingTransform(); return; }
          }

        // Don't start transforms if nothing is selected
        if ((e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 's') && Selection.size === 0) return;

      if ((e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 's') && Selection.size === 0) return;
      if (e.key.toLowerCase() === 'r'){ e.preventDefault(); beginTransform('rotate'); return; }
      if (e.key.toLowerCase() === 's'){ e.preventDefault(); beginTransform('scale');  return; }

      if (Transform.active && Transform.mode === 'rotate') {
        if (e.key === '['){ e.preventDefault(); rotateSelBy(-5); return; }
        if (e.key === ']'){ e.preventDefault(); rotateSelBy(+5); return; }
      }
      if (Transform.active && Transform.mode === 'scale') {
        if (e.key === '-'){ e.preventDefault(); scaleSelBy(0.90); return; }
        if (e.key === '=' || e.key === '+'){ e.preventDefault(); scaleSelBy(1.10); return; }
      }
      if (Transform.active && e.key === 'Escape'){ e.preventDefault(); endTransform();  return; }

        if (Transform.active && (e.key === 'Escape' || e.key === 'Esc')){
          e.preventDefault();
          endTransform();
          return;
        }
    });


        /* ---------- multi‑edit UI ---------- */
        function updateSelectionUI(){
          const cnt = Selection.size;
          if ($id("selCount")) $id("selCount").textContent = String(cnt);
          const showMulti = cnt > 1;
          if (!showMulti) endTransform();
          if (!showMulti) endHeadingTransform();

          // NEW: end live transform when leaving selection UI,
          // and toggle the selection-only keybinds box (added in §3)
          if (!showMulti) { try { endTransform(); } catch {} }
          $id("selectKeybinds")?.classList.toggle("hide", !showMulti);

          if ($id("folderPanel")) $id("folderPanel").classList.toggle("hide", showMulti);
          if ($id("multiPanel"))  $id("multiPanel").classList.toggle("hide", !showMulti);
          updateKeybindsVisibility();
          if (cnt > 0) {
            window.Draw?.cancel?.();
            applyMapCursor(null);
            storedMap?.setOptions?.({ draggable: true, draggableCursor: null, draggingCursor: null });
            document.querySelectorAll('#drawToolbar .btn').forEach(b => b.classList.remove('active'));
          }
        }
        function applySnapshots(markers, snaps){
            markers.forEach((m,i)=>applyMarkerSnapshot(m, snaps[i]));
                redrawFlightPaths(true); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();updateTimedShotsNote();
        }
        $id("applyBulkBtn")?.addEventListener("click", ()=>{
            const sel = Array.from(Selection); if(!sel.length) return;
            const alt = parseFloat($id("bulkAlt").value);
            const spd = parseFloat($id("bulkSpeed").value);
            const ang = parseFloat($id("bulkAngle").value);
            let act = ($id("bulkAction").value||"__keep__");

            // Restrict bulk "Action per point" to Premium
            if(!IS_PREMIUM && act !== "__keep__"){
                alert("Changing action per point in bulk is a Premium feature.");
                act = "__keep__";
                if ($id("bulkAction")) $id("bulkAction").value = "__keep__";
            }

            const before = sel.map(snapMarker);
            sel.forEach(m=>{
                if(!isNaN(alt)) m.altitude = alt;
                if(!isNaN(spd)) m.speed    = spd;
                if(!isNaN(ang)) m.angle    = ang;
                if(act !== "__keep__") m.action = act;
                setMarkerRotation(m, m.heading||0);
            });
            const after = sel.map(snapMarker);
            applySnapshots(sel, after);
            History.record({ undo:()=>applySnapshots(sel, before), redo:()=>applySnapshots(sel, after) });
        });
        $id("exitSelectionBtn")?.addEventListener("click", ()=>{
            const before = selectionIds();
            applySelectionByIds([]);
            History.record({ undo:()=>applySelectionByIds(before), redo:()=>applySelectionByIds([]) });
        });

        /* ---------- keybinds visibility ---------- */
        function updateKeybindsVisibility(){
            const advActive = document.getElementById("tab-settings")?.classList.contains("active");
            const folderVisible = !$id("folderPanel")?.classList.contains("hide");
            $id("keybindsBox")?.classList.toggle("hide", !(advActive && folderVisible));
        }
        $id("tab-settings-tab")?.addEventListener("shown.bs.tab", updateKeybindsVisibility);
        $id("tab-presets-tab")?.addEventListener("shown.bs.tab", updateKeybindsVisibility);
        $id("tab-export-tab")?.addEventListener("shown.bs.tab", updateKeybindsVisibility);

        /* ---------- Bootstrap init & Premium defaults ---------- */
        document.addEventListener('DOMContentLoaded', function () {
            // tooltips and popovers that hide on mouseleave even after click
            document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
                const inst = bootstrap.Tooltip.getInstance(el); if (inst) inst.dispose();
                const tt = new bootstrap.Tooltip(el, { trigger: 'hover focus' });
                el.addEventListener('mouseleave', ()=> tt.hide());
            });
            document.addEventListener('DOMContentLoaded', function () {
              // Turn mode: force Curved for non-Premium
              if (!IS_PREMIUM) {
                const tm = document.getElementById('in_turnMode');
                if (tm) tm.value = 'coordinateTurn';
              }
            });
            document.querySelectorAll('[data-bs-toggle="popover"]').forEach(el => {
                const inst = bootstrap.Popover.getInstance(el); if (inst) inst.dispose();
                const pop = new bootstrap.Popover(el, { trigger: 'click', html: true });
                el.addEventListener('mouseleave', ()=> pop.hide());
            });
            // premium badges tooltips
            [].slice.call(document.querySelectorAll('.premium-badge')).forEach(el => {
                el.setAttribute('data-bs-toggle','tooltip');
                el.setAttribute('data-bs-title','Premium feature — upgrade to enable');
                new bootstrap.Tooltip(el);
            });

            // Default line-direction: auto for Premium, E–W for non‑Premium
            const modeSel = $id("in_lineAngleMode");
            const degInput = $id("in_lineAngleDegrees");
            const degSuffix = $id("in_lineAngleSuffix");
            function updateAngleVisibility(){
                const on = modeSel && modeSel.value === "angle";
                if (degInput)  degInput.style.display = on ? "" : "none";
                if (degSuffix) degSuffix.style.display = on ? "" : "none";
            }
            degInput?.addEventListener("input", () => {
                let v = parseInt(degInput.value || "0", 10);
                if (isNaN(v)) v = 0;
                if (v < 0) v = 0;
                if (v > 179) v = 179;
                  degInput.value = String(v);
            });
            if (modeSel){
                modeSel.value = IS_PREMIUM ? "auto" : "preset";
                updateAngleVisibility();
                if (!IS_PREMIUM) {
                  const tm = document.getElementById('in_turnMode');
                  if (tm) tm.value = 'coordinateTurn';
                }
            }
            modeSel?.addEventListener("change", updateAngleVisibility);

            $id("in_units").addEventListener("change", onUnitsChanged);

            // Ensure in_distance is populated before any Generate
            updateOverlap();

            updateExportControls(); updateResetAvailability();
            updateKeybindsVisibility();
        });

        /* ---------- Curved path preview ---------- */
        function lerp(a,b,t){ return a + (b-a)*t; }
        function llLerp(A,B,t){ return { lat: lerp(A.lat, B.lat, t), lng: lerp(A.lng, B.lng, t) }; }
        function quadBezier(p0,p1,p2,t){
            const a = llLerp(p0,p1,t); const b = llLerp(p1,p2,t);
            return llLerp(a,b,t);
        }
        function curvedPreviewPath(flags){
            if(flags.length<2) return flags.map(m=>({lat:m.lat,lng:m.lng}));
            const result=[];
            for(let i=0;i<flags.length;i++){
                const cur = {lat:flags[i].lat, lng:flags[i].lng};
                if(i===0 || i===flags.length-1){ result.push(cur); continue; }
                const prev={lat:flags[i-1].lat,lng:flags[i-1].lng};
                const next={lat:flags[i+1].lat,lng:flags[i+1].lng};

                const tm = flags[i].turnMode || "coordinateTurn";
                const sharp = (tm==="toPointAndStopWithDiscontinuityCurvature");
                if(sharp){ result.push(cur); continue; }

                const tCorner = 0.15;
                const entry = llLerp(prev, cur, 1 - tCorner);
                const exit  = llLerp(cur, next, tCorner);

                result.push(entry);
                for(let t=0.125;t<1.0;t+=0.125){
                    const pt = quadBezier(entry, cur, exit, t);
                    result.push(pt);
                }
                result.push(exit);
            }
            return result;
        }

        function redrawFlightPaths(forceCurved=false){
            if (!storedMap) return;
            (storedMap.lines||[]).forEach(l=>l.setMap(null));
            (storedMap.curvedPreview||[]).forEach(l=>l.setMap(null));
            storedMap.lines=[]; storedMap.curvedPreview=[];

            const flags=(storedMap.flags||[]).slice().sort((a,b)=>a.id-b.id);
            if (flags.length<2) return;

            const straightPath=flags.map(m=>({lat:m.lat,lng:m.lng}));
            storedMap.lines.push(new google.maps.Polyline({map:storedMap,path:straightPath,strokeColor:'#6c757d',strokeOpacity:.5,strokeWeight:1}));

            const path=curvedPreviewPath(flags);
            storedMap.curvedPreview.push(new google.maps.Polyline({
                  map: storedMap,
                  path,
                  strokeColor: '#0d6efd',
                  strokeOpacity: .9,
                  strokeWeight: 2,
                  // Add arrowheads every ~80px to show direction of travel
                  icons: [{
                    icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW },
                    offset: '0',
                    repeat: '80px'
                  }]
                }));
        }

        /* ---------- Import KML/KMZ overlays ---------- */
        $id("importOverlayBtn").addEventListener("click", ()=> $id("overlayFile").click());
            $id("overlayFile").addEventListener("change", async function () {
      if (!this.files || this.files.length === 0) return;

      for (const file of this.files) {
        const ext = file.name.split(".").pop().toLowerCase();

        // 1) Ask server to "smart" parse (DJI WPML or overlays)
        const fd = new FormData(); fd.append("file", file);
        const res = await fetch("/Home/ImportKmzSmart", { method: "POST", body: fd });

        if (!res.ok) {
          const t = await res.text();
          alert(`Overlay import failed for ${file.name}\n\n${(t || "").slice(0,800)}`);
          continue;
        }

        const payload = await res.json();

        if (payload && payload.kind === "dji-mission" && Array.isArray(payload.waypoints)) {
          addDjiWaypoints(payload, file.name);
        } else {
          // normal overlay path
          drawOverlaysFromPayload(payload, file.name);
          fitMapToOverlays(payload.overlays || []);
        }
      }

      this.value = "";
      updateResetAvailability();
    });

            function num(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function pick(o, ...keys) {
      for (const k of keys) if (o[k] != null) return o[k];
      return undefined;
    }
    function int01(v) {
      if (v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return n ? 1 : 0;
    }

    // Consumes a payload like { kind: "dji-mission", waypoints: [...] }
    function addDjiWaypoints(payload, fileName) {
      const created = [];
      const b = new google.maps.LatLngBounds();

      (payload.waypoints || []).forEach(p => {
        // Accept camelCase or PascalCase; coerce to numbers
        const lat = num(pick(p, "Latitude", "latitude", "lat", "Lat"));
        const lng = num(pick(p, "Longitude", "longitude", "lng", "Lon", "Lng"));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          console.warn("Skipping invalid waypoint (no lat/lng):", p);
          return;
        }

        const heading   = num(pick(p, "heading", "Heading")) ?? 0;
        const gimbalAng = num(pick(p, "gimbalAngle", "GimbalAngle"));
        const turnMode  = pick(p, "turnMode", "TurnMode") || "coordinateTurn";
        const action    = pick(p, "action", "Action") || "noAction";
        const useSL     = int01(pick(p, "useStraightLine", "UseStraightLine"));
        const dampDist  = num(pick(p, "waypointTurnDampingDist", "WaypointTurnDampingDist"));

        const m = createWaypointMarker(
          { lat, lng },
          {
            heading: heading,
            turnMode: turnMode,
            gimbalAngle: gimbalAng,
            action: action,
            useStraightLine: useSL,
            waypointTurnDampingDist: dampDist
          },
          { skipHistory: true }
        );

        // OPTIONAL: if your server includes altitude/speed and you want to apply them:
        const alt = num(pick(p, "altitude", "Altitude"));
        if (alt != null) m.altitude = alt;
        const spd = num(pick(p, "speed", "Speed"));
        if (spd != null) m.speed = spd;

        created.push(m);
        b.extend(new google.maps.LatLng(lat, lng));
      });

      if (!b.isEmpty()) storedMap.fitBounds(b, 60);
      redrawFlightPaths(true);
      updateExportAvailability(); updateETA(); updateWaypointCountWarnings(); updatePhotoCadenceWarning();

      History.record({
        undo: () => created.forEach(removeMarkerFromStore),
        redo: () => created.forEach(addMarkerToMap)
      });
    }

    // Fit to overlays after drawing
    function fitMapToOverlays(overlays) {
      if (!overlays || overlays.length === 0 || !storedMap) return;
      const b = new google.maps.LatLngBounds();
      overlays.forEach(ov => {
        if (ov.type === "polygon" || ov.type === "polyline") {
          (ov.path || []).forEach(p => b.extend(new google.maps.LatLng(p.lat, p.lng)));
        } else if (ov.type === "image" && ov.north != null && ov.south != null && ov.east != null && ov.west != null) {
          const bounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(ov.south, ov.west),
            new google.maps.LatLng(ov.north, ov.east)
          );
          b.union(bounds);
        }
      });
      if (!b.isEmpty()) storedMap.fitBounds(b, 60);
    }

        function drawOverlaysFromPayload(payload, fileName){
            if(!payload || !Array.isArray(payload.overlays)) return;
            payload.overlays.forEach(ov=>{
                let shape=null;
                if(ov.type==="polygon"){
                    const path = ov.path.map(p=>({lat:p.lat,lng:p.lng}));
                    shape = new google.maps.Polygon({map:storedMap, paths:path, strokeColor:"#198754", strokeOpacity:.9, strokeWeight:2, fillColor:"#198754", fillOpacity:.08, clickable:true});
                    bindOverlayClick(shape, ov.name || fileName);
                }else if(ov.type==="polyline"){
                    const path = ov.path.map(p=>({lat:p.lat,lng:p.lng}));
                    shape = new google.maps.Polyline({map:storedMap, path, strokeColor:"#198754", strokeOpacity:.9, strokeWeight:2, clickable:true});
                    bindOverlayClick(shape, ov.name || fileName);
                }else if(ov.type==="image"){
                    if(ov.imageDataUri){
                        const bounds = new google.maps.LatLngBounds(
                            new google.maps.LatLng(ov.south, ov.west),
                            new google.maps.LatLng(ov.north, ov.east)
                        );
                        shape = new google.maps.GroundOverlay(ov.imageDataUri, bounds, {map:storedMap, clickable:true, opacity:0.6});
                        bindOverlayClick(shape, ov.name || (fileName+" (image)"), true);
                    }else{
                        const bounds = new google.maps.LatLngBounds(
                            new google.maps.LatLng(ov.south, ov.west),
                            new google.maps.LatLng(ov.north, ov.east)
                        );
                        shape = new google.maps.Rectangle({map:storedMap, bounds, strokeColor:"#198754", strokeOpacity:.9, strokeWeight:2, fillColor:"#198754", fillOpacity:.08, clickable:true});
                        bindOverlayClick(shape, ov.name || (fileName+" (image bounds)"));
                    }
                }
                if(shape) pushOverlay({ name: ov.name || fileName, type: ov.type, shape });
            });
        }

            function bindOverlayClick(shape, title) {
              google.maps.event.addListener(shape, "click", (e) => {
                const iw = storedMap.infoWindow;
                const html =
                  '<div class="text-center">' +
                    `<div class="fw-semibold mb-1">${title}</div>` +
                    '<div class="d-grid gap-2">' +
                      '<button class="btn btn-outline-danger btn-sm" id="ov-remove">Remove</button>' +
                      '<button class="btn btn-outline-danger btn-sm" id="ov-remove-all">Remove all</button>' +
                    '</div>' +
                  '</div>';

                const root = document.createElement('div');
                root.innerHTML = html;

                iw._wmToken = (iw._wmToken || 0) + 1;
                const myToken = iw._wmToken;

                const pos = (e && e.latLng) || (shape.getBounds?.()?.getCenter?.());
                iw.setContent(root);
                if (pos) iw.setPosition(pos);
                iw.open({ map: storedMap });

                google.maps.event.addListenerOnce(iw, "domready", () => {
                  if (iw._wmToken !== myToken) return;
                  if (iw.getContent() !== root) return;

                  root.querySelector("#ov-remove")?.addEventListener("click", () => {
                    const rec = OverlayStore.list.find(o => o.shape === shape);
                    if (rec) removeOverlayById(rec.__id);
                    iw.close();
                  });
                  root.querySelector("#ov-remove-all")?.addEventListener("click", () => {
                    clearOverlays();
                    iw.close();
                  });
                });
              });
            }

        /* ---------- >100 WP warning ---------- */
        function updateWaypointCountWarnings(){
            const note = $id("wpCountNote");
            if (!note) return;
            const count = (storedMap?.flags?.length || 0);
            let show = false;

            if (IS_PREMIUM && $id("splitToggle")?.checked) {
                  note.classList.add("hide");
                  return;
            }

            if (count > 100){
                const split = $id("splitToggle")?.checked;
                if (split){
                    const mins = parseFloat($id("batteryMinutes")?.value || "20") || 20;
                    const segs = computeSegmentsByBattery(mins * 60);
                    const maxLen = segs.reduce((m,s)=> Math.max(m, s.length), 0);
                    show = maxLen > 100;
                } else {
                    show = true;
                }
            }
            note.classList.toggle("hide", !show);
        }
        $id("batteryMinutes")?.addEventListener("input", updateWaypointCountWarnings);

        /* ---------- Photo cadence warning (< 5s between consecutive takePhoto points) ---------- */
        function updatePhotoCadenceWarning(){
            const note = $id("photoCadenceNote");
            if (!note) return;

            const flags = (storedMap?.flags||[]).slice().sort((a,b)=>a.id-b.id);
            let warn = false;
            if (flags.length >= 2){
                for (let i=1; i<flags.length; i++){
                    const a = flags[i-1], b = flags[i];
                    if ((a.action === "takePhoto") && (b.action === "takePhoto")){
                        const d = haversine({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng});
                        const spdMps = unitMode ? ((a.speed+b.speed)/2/M2FT) : ((a.speed+b.speed)/2);
                        const t = (spdMps>0) ? (d/spdMps) : 0;
                        if (t < 5){ warn = true; break; }
                    }
                }
            }
            note.classList.toggle("hide", !warn);
        }

        /* ---------- expose inline ---------- */
        window.generateAllShapes = generateAllShapes;
        window.removeSelectedShape = removeSelectedShape;

    const $ = (id) => document.getElementById(id);

      function getIsPremium() {
        // Use the global if present; otherwise fall back to data-premium
        if (typeof IS_PREMIUM !== 'undefined') return !!IS_PREMIUM;
        const group = $('overlapGroup');
        return group && group.dataset.premium === 'true';
      }

          function updateOverlapLocks() {
          const $ = (id) => document.getElementById(id);

          const group        = $('overlapGroup');
          const groupVeil    = group ? group.querySelector('.premium-veil') : null;

          const intervalDiv  = $('interval_div');
          const intervalIn   = $('in_interval');
          const intervalVeil = intervalDiv ? intervalDiv.querySelector('.interval-veil') : null;

          if (!intervalDiv || !intervalIn || !intervalVeil) return;

          // Use whatever premium check you actually have:
          const isPremium = (typeof getIsPremium === 'function')
            ? !!getIsPremium()
            : (typeof IS_PREMIUM !== 'undefined' ? !!IS_PREMIUM : true);

          const genAll = !!$('in_generateAllPoints')?.checked;

          // Reset base state
          intervalDiv.hidden   = false;         // never hide the row anymore
          intervalIn.disabled  = false;
          intervalVeil.hidden  = true;
          if (groupVeil) groupVeil.style.display = isPremium ? 'none' : '';

          // Non‑premium users still see the group veil and cannot edit
          if (!isPremium) {
            intervalIn.disabled = true;
            return;
          }

          // ✅ Only lock & veil when "Generate every point" is ON.
          if (genAll) {
            intervalIn.disabled = true;
            intervalVeil.hidden = false;
            const msg = intervalVeil.querySelector('.text');
            if (msg) msg.textContent = '“Generate every point” disables camera interval';
          }
        }

      // Wire once
      ['in_allPointsAction', 'in_generateAllPoints'].forEach(id => {
        const el = $(id);
        el?.addEventListener('change', updateOverlapLocks);
      });

          window.hideShowInterval = updateOverlapLocks;

      document.addEventListener('DOMContentLoaded', updateOverlapLocks);
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        updateOverlapLocks();
      }

      // If the checkbox still has onchange="hideShowInterval()", point it here:
      window.hideShowInterval = updateOverlapLocks;
    })();
