/**
 * Panel de encuestas de módulo.
 *
 * The same file runs inside Moodle (mod/encuestamod/manage.php, report.php) and in the
 * external subdomain panel. Configuration comes from window.ENCUESTAS_CONFIG:
 *   api        URL of the JSON endpoint
 *   sesskey    Moodle session key (inside Moodle)
 *   csrf       CSRF token (subdomain panel)
 *   mode       'full' | 'report' (one survey) | 'coursereport' (one course)
 *   cmid / courseid  for report modes
 *   canedit    whether bulk actions and question editing are allowed
 *   canusers   whether the "Usuarios" tab is available (subdomain panel, admin role)
 *   user, logouturl, connecturl, moodleurl, title
 *
 * @copyright  2026 Juan David Oviedo Rodríguez
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
(function() {
    'use strict';

    var CFG = window.ENCUESTAS_CONFIG || {};
    var root = null;
    var BATCH = 15;

    var S = {
        view: 'courses',
        overview: null,
        sets: null,
        selected: {},
        expanded: {},
        qCourse: '',
        qSection: '',
        show: 'all',
        report: null,
        reportParams: null,
        reportStack: [],
        editing: null,
        users: null,
        error: ''
    };

    var QTYPES = {single: 'Opción única', multiple: 'Varias opciones', text: 'Respuesta abierta'};

    // ------------------------------------------------------------------ helpers

    function esc(v) {
        return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function(c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
        });
    }

    function norm(v) {
        return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function pct(a, b) {
        return b ? Math.round(1000 * a / b) / 10 : 0;
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    function api(action, payload) {
        return fetch(CFG.api, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrf || ''},
            body: JSON.stringify({action: action, payload: payload || {}, sesskey: CFG.sesskey || ''})
        }).then(function(r) {
            return r.text();
        }).then(function(text) {
            var j;
            try {
                j = JSON.parse(text);
            } catch (e) {
                throw new Error('Respuesta inesperada del servidor: ' + text.replace(/<[^>]+>/g, ' ').slice(0, 300));
            }
            if (!j.ok) {
                if (j.login) {
                    window.location.reload();
                }
                throw new Error(j.error || 'Error desconocido');
            }
            return j.data;
        });
    }

    function $(sel) {
        return root.querySelector(sel);
    }

    // ------------------------------------------------------------------ modal / toast

    var modalEl = null;

    function closeModal() {
        if (modalEl) {
            modalEl.remove();
            modalEl = null;
        }
    }

    /**
     * @param {Object} o {title, body, buttons: [{label, cls, onClick}], wide}
     * @returns {HTMLElement}
     */
    function modal(o) {
        closeModal();
        modalEl = document.createElement('div');
        modalEl.className = 'ea-root ea-modal-wrap';
        var buttons = (o.buttons || [{label: 'Cerrar', cls: 'ea-btn'}]).map(function(b, i) {
            return '<button type="button" class="' + esc(b.cls || 'ea-btn') + '" data-mbtn="' + i + '">' +
                esc(b.label) + '</button>';
        }).join('');
        modalEl.innerHTML = '<div class="ea-modal' + (o.wide ? ' ea-modal-wide' : '') + '" role="dialog" aria-modal="true">' +
            '<div class="ea-modal-head"><h3>' + esc(o.title || '') + '</h3>' +
            '<button type="button" class="ea-x" data-mclose="1" aria-label="Cerrar">×</button></div>' +
            '<div class="ea-modal-body">' + (o.body || '') + '</div>' +
            '<div class="ea-modal-foot">' + buttons + '</div></div>';
        document.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) {
            if (e.target === modalEl || e.target.closest('[data-mclose]')) {
                closeModal();
                return;
            }
            var b = e.target.closest('[data-mbtn]');
            if (b) {
                var def = (o.buttons || [])[Number(b.getAttribute('data-mbtn'))];
                if (def && def.onClick) {
                    def.onClick(modalEl);
                } else {
                    closeModal();
                }
            }
        });
        var first = modalEl.querySelector('input, select, textarea');
        if (first) {
            first.focus();
        }
        return modalEl;
    }

    function alertModal(title, msg) {
        modal({title: title, body: '<p>' + esc(msg) + '</p>'});
    }

    function busy(msg) {
        modal({title: 'Un momento…', body: '<div class="ea-busy"><span class="ea-spinner"></span><span id="ea-busy-msg">' +
            esc(msg || 'Trabajando…') + '</span></div>', buttons: []});
    }

    function busyMsg(msg) {
        var el = document.getElementById('ea-busy-msg');
        if (el) {
            el.textContent = msg;
        }
    }

    function toast(msg) {
        var t = document.createElement('div');
        t.className = 'ea-root ea-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() {
            t.classList.add('ea-toast-out');
        }, 2600);
        setTimeout(function() {
            t.remove();
        }, 3200);
    }

    // ------------------------------------------------------------------ shell

    function render() {
        if (!root) {
            return;
        }
        var html = '';
        if (CFG.mode === 'full' || !CFG.mode) {
            html += renderHeader();
        }
        html += '<div class="ea-main">';
        if (S.error) {
            html += '<div class="ea-alert ea-alert-error">' + esc(S.error) + '</div>';
        }
        if (S.view === 'courses') {
            html += renderCourses();
        } else if (S.view === 'sets') {
            html += S.editing ? renderSetEditor() : renderSets();
        } else if (S.view === 'report') {
            html += renderReport();
        } else if (S.view === 'users') {
            html += renderUsers();
        }
        html += '</div>';
        root.innerHTML = html;
        if (S.view === 'courses') {
            root.querySelectorAll('[data-partial]').forEach(function(el) {
                el.indeterminate = true;
            });
            updateActionBar();
        }
    }

    function renderHeader() {
        var tabs = [['courses', 'Cursos y módulos'], ['sets', 'Preguntas']];
        if (CFG.canusers) {
            tabs.push(['users', 'Usuarios']);
        }
        var active = S.view === 'report' ? 'courses' : S.view;
        var right = '';
        if (CFG.user) {
            right += '<span class="ea-user">' + esc(CFG.user) + (CFG.rolelabel ? ' · ' + esc(CFG.rolelabel) : '') + '</span>';
        }
        if (CFG.connecturl) {
            right += '<a class="ea-link" href="' + esc(CFG.connecturl) + '">Conectar panel externo</a>';
        }
        if (CFG.logouturl) {
            right += '<a class="ea-btn ea-btn-sm" href="' + esc(CFG.logouturl) + '">Salir</a>';
        }
        return '<div class="ea-header ea-noprint">' +
            '<div class="ea-tabs">' + tabs.map(function(t) {
                return '<button type="button" class="ea-tab' + (active === t[0] ? ' is-active' : '') +
                    '" data-act="tab" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
            }).join('') + '</div><div class="ea-header-right">' + right + '</div></div>';
    }

    // ------------------------------------------------------------------ courses view

    function courseHasSurveys(c) {
        return c.sections.some(function(s) {
            return s.surveys.length > 0;
        });
    }

    function visibleCourses() {
        if (!S.overview) {
            return [];
        }
        var q = norm(S.qCourse);
        return S.overview.courses.filter(function(c) {
            if (q && norm(c.fullname + ' ' + c.shortname + ' ' + c.category).indexOf(q) === -1) {
                return false;
            }
            if (S.show === 'with' && !courseHasSurveys(c)) {
                return false;
            }
            if (S.show === 'without' && courseHasSurveys(c)) {
                return false;
            }
            return true;
        });
    }

    function visibleSections(c) {
        var q = norm(S.qSection);
        return c.sections.filter(function(s) {
            return !q || norm(s.name).indexOf(q) !== -1;
        });
    }

    function renderCourses() {
        if (!S.overview) {
            return '<div class="ea-loading">Cargando cursos…</div>';
        }
        var edit = !!CFG.canedit;
        var totalSurveys = 0;
        var totalCourses = S.overview.courses.length;
        S.overview.courses.forEach(function(c) {
            c.sections.forEach(function(s) {
                totalSurveys += s.surveys.length;
            });
        });
        var html = '<div class="ea-intro ea-noprint"><div><h2>Encuestas de fin de módulo</h2>' +
            '<p>' + plural(totalCourses, 'curso', 'cursos') + ' · ' + plural(totalSurveys, 'encuesta', 'encuestas') +
            '. ' + (edit ? 'Marca los módulos y elige una acción abajo: se aplica a todos a la vez.' : '') +
            '</p></div></div>';
        html += '<div class="ea-toolbar ea-noprint">' +
            '<input type="search" class="ea-input" id="ea-qcourse" placeholder="Buscar curso…" value="' + esc(S.qCourse) + '">' +
            '<input type="search" class="ea-input" id="ea-qsection" placeholder="Filtrar módulos por nombre (ej: Modulo)" value="' +
            esc(S.qSection) + '">' +
            '<select class="ea-input ea-select" id="ea-show">' +
            '<option value="all"' + (S.show === 'all' ? ' selected' : '') + '>Todos los cursos</option>' +
            '<option value="with"' + (S.show === 'with' ? ' selected' : '') + '>Con encuestas</option>' +
            '<option value="without"' + (S.show === 'without' ? ' selected' : '') + '>Sin encuestas</option></select>' +
            (edit ? '<button type="button" class="ea-btn" data-act="selectfiltered">Seleccionar módulos filtrados</button>' +
                '<button type="button" class="ea-btn ea-btn-ghost" data-act="clearsel">Quitar selección</button>' : '') +
            '<button type="button" class="ea-btn ea-btn-ghost" data-act="expandall">Expandir todo</button>' +
            '<button type="button" class="ea-btn ea-btn-ghost" data-act="collapseall">Contraer todo</button>' +
            '<button type="button" class="ea-btn ea-btn-ghost" data-act="reload" title="Recargar">↻</button>' +
            '</div>';
        html += '<div id="ea-courselist">' + renderCourseList() + '</div>';
        if (edit) {
            html += '<div class="ea-actionbar ea-noprint" id="ea-actionbar" hidden></div>';
        }
        return html;
    }

    function renderCourseList() {
        var courses = visibleCourses();
        if (!courses.length) {
            return '<div class="ea-empty">No hay cursos que coincidan con la búsqueda.</div>';
        }
        var forceOpen = !!(S.qSection || S.qCourse);
        return courses.map(function(c) {
            return renderCourse(c, forceOpen || !!S.expanded[c.id]);
        }).join('');
    }

    function renderCourse(c, open) {
        var edit = !!CFG.canedit;
        var sections = visibleSections(c);
        var surveys = 0;
        c.sections.forEach(function(s) {
            surveys += s.surveys.length;
        });
        var allSel = sections.length > 0 && sections.every(function(s) {
            return S.selected[s.id];
        });
        var someSel = sections.some(function(s) {
            return S.selected[s.id];
        });
        var head = '<div class="ea-course-head">' +
            (edit ? '<input type="checkbox" class="ea-check" data-act="selcourse" data-course="' + c.id + '"' +
                (allSel ? ' checked' : '') + (someSel && !allSel ? ' data-partial="1"' : '') +
                ' title="Seleccionar los módulos visibles de este curso">' : '') +
            '<button type="button" class="ea-course-toggle" data-act="toggle" data-course="' + c.id + '">' +
            '<span class="ea-caret">' + (open ? '▾' : '▸') + '</span>' +
            '<span class="ea-course-name">' + esc(c.fullname) + '</span>' +
            '<span class="ea-muted">' + esc(c.shortname) + (c.category ? ' · ' + esc(c.category) : '') + '</span></button>' +
            '<div class="ea-course-meta">' +
            (!c.visible ? '<span class="ea-badge ea-badge-muted">Curso oculto</span>' : '') +
            (!c.completion ? '<span class="ea-badge ea-badge-warn" title="Se activa solo al crear encuestas">Sin finalización</span>' : '') +
            '<span class="ea-badge">' + plural(c.students, 'estudiante', 'estudiantes') + '</span>' +
            '<span class="ea-badge ' + (surveys ? 'ea-badge-ok' : 'ea-badge-muted') + '">' +
            plural(surveys, 'encuesta', 'encuestas') + '</span>' +
            (surveys ? '<button type="button" class="ea-btn ea-btn-sm" data-act="coursereport" data-course="' + c.id +
                '">Informe del curso</button>' : '') +
            '</div></div>';
        if (!open) {
            return '<div class="ea-course">' + head + '</div>';
        }
        var hiddenCount = c.sections.length - sections.length;
        var rows = sections.map(function(s) {
            return renderSectionRow(c, s);
        }).join('');
        return '<div class="ea-course is-open">' + head +
            '<div class="ea-table-wrap"><table class="ea-table"><thead><tr>' +
            (edit ? '<th class="ea-col-check"></th>' : '') +
            '<th>Módulo</th><th>Encuesta</th><th>Estado</th><th>Obligatoria</th><th>Modo</th><th>Preguntas</th>' +
            '<th>Respuestas</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            (hiddenCount ? '<div class="ea-muted ea-small ea-pad">' + plural(hiddenCount, 'sección oculta', 'secciones ocultas') +
                ' por el filtro de módulos.</div>' : '') +
            '</div>';
    }

    function renderSectionRow(c, s) {
        var edit = !!CFG.canedit;
        var check = edit ? '<td class="ea-col-check"><input type="checkbox" class="ea-check" data-act="selsection" data-section="' +
            s.id + '" data-course="' + c.id + '"' + (S.selected[s.id] ? ' checked' : '') + '></td>' : '';
        var modname = '<td><div class="ea-strong">' + esc(s.name) + '</div><div class="ea-muted ea-small">Sección ' + s.num +
            (!s.visible ? ' · oculta' : '') + ' · ' + plural(s.activities, 'actividad', 'actividades') + '</div></td>';
        if (!s.surveys.length) {
            return '<tr class="' + (S.selected[s.id] ? 'is-selected' : '') + '">' + check + modname +
                '<td colspan="7" class="ea-muted">Sin encuesta</td></tr>';
        }
        return s.surveys.map(function(v, i) {
            var warn = [];
            if (!v.islast) {
                warn.push('<span class="ea-badge ea-badge-warn" title="Hay actividades después de la encuesta. Usa «Mover al final».">No está al final</span>');
            }
            if (v.chain) {
                warn.push('<span class="ea-muted ea-small" title="La encuesta se abre al completar esta actividad">Se abre tras: ' +
                    esc(v.chain) + '</span>');
            }
            var rate = pct(v.responses, c.students);
            return '<tr class="' + (S.selected[s.id] ? 'is-selected' : '') + '">' +
                (i === 0 ? check.replace('<td', '<td rowspan="' + s.surveys.length + '"') : '') +
                (i === 0 ? modname.replace('<td', '<td rowspan="' + s.surveys.length + '"') : '') +
                '<td><div>' + esc(v.name) + '</div>' + (warn.length ? '<div class="ea-row-notes">' + warn.join(' ') + '</div>' : '') +
                '</td>' +
                '<td>' + (v.visible ? '<span class="ea-badge ea-badge-ok">Activa</span>' :
                    '<span class="ea-badge ea-badge-muted">Desactivada</span>') + '</td>' +
                '<td>' + (v.mandatory ? '<span class="ea-badge ea-badge-strong">Sí</span>' +
                    (v.gated ? '<div class="ea-muted ea-small">bloquea: ' + esc(v.gated) + '</div>' :
                        '<div class="ea-muted ea-small">' + (v.visible ? 'sin módulo siguiente' : 'se aplica al activarla') + '</div>') :
                    '<span class="ea-muted">No</span>') + '</td>' +
                '<td>' + (v.anonymous ? 'Anónima' : 'Identificada') + '</td>' +
                '<td class="ea-small">' + esc(v.setname) + '</td>' +
                '<td><div class="ea-rate"><span>' + v.responses + ' / ' + c.students + '</span>' +
                '<span class="ea-bar"><span style="width:' + Math.min(100, rate) + '%"></span></span></div></td>' +
                '<td><button type="button" class="ea-btn ea-btn-sm" data-act="report" data-cmid="' + v.cmid +
                '">Informe</button></td></tr>';
        }).join('');
    }

    function selectionInfo() {
        var ids = Object.keys(S.selected);
        var courses = {};
        var withSurvey = 0;
        var surveys = 0;
        var responses = 0;
        if (S.overview) {
            S.overview.courses.forEach(function(c) {
                c.sections.forEach(function(s) {
                    if (S.selected[s.id]) {
                        courses[c.id] = true;
                        if (s.surveys.length) {
                            withSurvey++;
                            surveys += s.surveys.length;
                            s.surveys.forEach(function(v) {
                                responses += v.responses;
                            });
                        }
                    }
                });
            });
        }
        return {sections: ids.length, courses: Object.keys(courses).length, withSurvey: withSurvey,
            without: ids.length - withSurvey, surveys: surveys, responses: responses};
    }

    function updateActionBar() {
        var bar = document.getElementById('ea-actionbar');
        if (!bar) {
            return;
        }
        var info = selectionInfo();
        if (!info.sections) {
            bar.hidden = true;
            bar.innerHTML = '';
            return;
        }
        bar.hidden = false;
        bar.innerHTML = '<div class="ea-actionbar-info"><strong>' + plural(info.sections, 'módulo seleccionado', 'módulos seleccionados') +
            '</strong> en ' + plural(info.courses, 'curso', 'cursos') + ' · ' + info.withSurvey + ' con encuesta · ' +
            info.without + ' sin encuesta</div><div class="ea-actionbar-btns">' +
            '<button type="button" class="ea-btn ea-btn-primary" data-act="bulk-create">Crear encuestas</button>' +
            '<button type="button" class="ea-btn" data-act="bulk" data-bulk="show">Activar</button>' +
            '<button type="button" class="ea-btn" data-act="bulk" data-bulk="hide">Desactivar</button>' +
            '<button type="button" class="ea-btn" data-act="bulk" data-bulk="mandatory_on">Hacer obligatoria</button>' +
            '<button type="button" class="ea-btn" data-act="bulk" data-bulk="mandatory_off">Quitar obligatoria</button>' +
            '<button type="button" class="ea-btn" data-act="bulk-questions">Cambiar preguntas</button>' +
            '<button type="button" class="ea-btn" data-act="bulk-more">Más…</button>' +
            '<button type="button" class="ea-btn ea-btn-danger" data-act="bulk-delete">Eliminar</button>' +
            '</div>';
    }

    function refreshCourseList() {
        var list = document.getElementById('ea-courselist');
        if (list) {
            list.innerHTML = renderCourseList();
            list.querySelectorAll('[data-partial]').forEach(function(el) {
                el.indeterminate = true;
            });
        }
        updateActionBar();
    }

    // ------------------------------------------------------------------ bulk actions

    var BULK_LABELS = {
        create: 'Crear encuestas',
        show: 'Activar encuestas',
        hide: 'Desactivar encuestas',
        mandatory_on: 'Hacer obligatorias',
        mandatory_off: 'Quitar obligatoriedad',
        setquestions: 'Cambiar preguntas',
        anon_on: 'Volver anónimas',
        anon_off: 'Volver identificadas',
        chain_on: 'Abrir solo al terminar el módulo',
        chain_off: 'Abrir sin esperar otra actividad',
        movetoend: 'Mover al final del módulo',
        delete: 'Eliminar encuestas'
    };

    var BULK_HELP = {
        show: 'Los estudiantes verán la encuesta. Si es obligatoria, el módulo siguiente vuelve a quedar bloqueado hasta responderla.',
        hide: 'La encuesta queda oculta para los estudiantes. Mientras esté desactivada no bloquea el módulo siguiente.',
        mandatory_on: 'El módulo siguiente quedará bloqueado hasta que el estudiante responda la encuesta. ' +
            'Las demás restricciones del módulo se conservan.',
        mandatory_off: 'Se quita el bloqueo del módulo siguiente (solo la condición de la encuesta).',
        anon_on: 'A partir de ahora las respuestas nuevas no se asocian al estudiante. Las respuestas ya recibidas dejan de mostrarse por estudiante.',
        anon_off: 'A partir de ahora las respuestas nuevas quedan asociadas al estudiante. Las respuestas anónimas anteriores siguen siendo anónimas.',
        chain_on: 'La encuesta se abre cuando el estudiante completa la última actividad del módulo (como el resto de actividades encadenadas).',
        chain_off: 'La encuesta queda disponible sin esperar a otra actividad.',
        movetoend: 'Mueve la encuesta al final del módulo (útil si agregaste actividades después de crearla).'
    };

    function selectedIds() {
        return Object.keys(S.selected).map(Number);
    }

    function runBulk(action, options) {
        var ids = selectedIds();
        var all = {results: [], summary: {ok: 0, skip: 0, error: 0}};
        var i = 0;
        busy('Aplicando «' + BULK_LABELS[action] + '»…');
        function next() {
            if (i >= ids.length) {
                return Promise.resolve(all);
            }
            var chunk = ids.slice(i, i + BATCH);
            busyMsg('Procesando ' + Math.min(i + chunk.length, ids.length) + ' de ' + ids.length + ' módulos…');
            return api('bulk', {action: action, sections: chunk, options: options || {}}).then(function(res) {
                all.results = all.results.concat(res.results);
                ['ok', 'skip', 'error'].forEach(function(k) {
                    all.summary[k] += res.summary[k] || 0;
                });
                i += chunk.length;
                return next();
            });
        }
        return next().then(function(res) {
            showResults(action, res);
            return reloadOverview(true);
        }).catch(function(e) {
            alertModal('No se pudo completar', e.message);
            return reloadOverview(true);
        });
    }

    function showResults(action, res) {
        var rows = res.results.map(function(r) {
            var cls = r.status === 'ok' ? 'ea-badge-ok' : (r.status === 'skip' ? 'ea-badge-muted' : 'ea-badge-error');
            var label = r.status === 'ok' ? 'Hecho' : (r.status === 'skip' ? 'Omitido' : 'Error');
            return '<tr><td>' + esc(r.course) + '</td><td>' + esc(r.section) + '</td><td><span class="ea-badge ' + cls + '">' +
                label + '</span></td><td class="ea-small">' + esc(r.message) + '</td></tr>';
        }).join('');
        var s = res.summary;
        modal({
            title: BULK_LABELS[action] + ': resultado',
            wide: true,
            body: '<div class="ea-chips"><span class="ea-badge ea-badge-ok">' + s.ok + ' hechos</span>' +
                '<span class="ea-badge ea-badge-muted">' + s.skip + ' omitidos</span>' +
                (s.error ? '<span class="ea-badge ea-badge-error">' + s.error + ' con error</span>' : '') + '</div>' +
                '<div class="ea-table-wrap ea-scroll"><table class="ea-table"><thead><tr><th>Curso</th><th>Módulo</th><th>Estado</th>' +
                '<th>Detalle</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
            buttons: [{label: 'Listo', cls: 'ea-btn ea-btn-primary'}]
        });
    }

    function setOptions(selected) {
        return (S.overview ? S.overview.sets : []).map(function(st) {
            return '<option value="' + st.id + '"' + (Number(selected) === st.id ? ' selected' : '') + '>' + esc(st.name) + '</option>';
        }).join('');
    }

    function openCreate() {
        var info = selectionInfo();
        modal({
            title: 'Crear encuestas al final de cada módulo',
            body: '<p>Se creará una encuesta al final de <strong>' + plural(info.without, 'módulo', 'módulos') +
                '</strong>' + (info.withSurvey ? ' (los ' + info.withSurvey + ' que ya tienen encuesta se omiten)' : '') + '.</p>' +
                '<label class="ea-field"><span>Preguntas</span><select class="ea-input" id="ea-c-set">' +
                setOptions(S.overview.defaultset) + '</select></label>' +
                '<label class="ea-field"><span>Nombre de cada encuesta</span><input class="ea-input" id="ea-c-name" value="' +
                esc('Encuesta de evaluación – {modulo}') + '"><small>{modulo} = nombre del módulo · {curso} = nombre del curso · ' +
                '{curso_corto} = nombre corto</small></label>' +
                '<label class="ea-check-row"><input type="checkbox" id="ea-c-mandatory" checked> <span><strong>Obligatoria para continuar</strong>: ' +
                'el módulo siguiente se bloquea hasta responderla</span></label>' +
                '<label class="ea-check-row"><input type="checkbox" id="ea-c-chain" checked> <span><strong>Abrir al terminar el módulo</strong>: ' +
                'se habilita al completar la última actividad del módulo</span></label>' +
                '<label class="ea-check-row"><input type="checkbox" id="ea-c-anon"> <span><strong>Anónima</strong>: no se verá qué respondió ' +
                'cada estudiante (sí quién falta)</span></label>' +
                '<label class="ea-check-row"><input type="checkbox" id="ea-c-visible" checked> <span><strong>Visible</strong> para los ' +
                'estudiantes desde ya</span></label>',
            buttons: [
                {label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'},
                {label: 'Crear encuestas', cls: 'ea-btn ea-btn-primary', onClick: function(m) {
                    var opts = {
                        setid: Number(m.querySelector('#ea-c-set').value),
                        namepattern: m.querySelector('#ea-c-name').value,
                        mandatory: m.querySelector('#ea-c-mandatory').checked ? 1 : 0,
                        chain: m.querySelector('#ea-c-chain').checked ? 1 : 0,
                        anonymous: m.querySelector('#ea-c-anon').checked ? 1 : 0,
                        visible: m.querySelector('#ea-c-visible').checked ? 1 : 0
                    };
                    runBulk('create', opts);
                }}
            ]
        });
    }

    function openQuestions() {
        var info = selectionInfo();
        modal({
            title: 'Cambiar las preguntas',
            body: '<p>Las <strong>' + plural(info.surveys, 'encuesta', 'encuestas') + '</strong> de los módulos seleccionados usarán este ' +
                'conjunto de preguntas. Las respuestas ya recibidas se conservan con sus preguntas originales.</p>' +
                '<label class="ea-field"><span>Conjunto de preguntas</span><select class="ea-input" id="ea-q-set">' +
                setOptions(S.overview.defaultset) + '</select></label>' +
                '<p class="ea-muted ea-small">¿Quieres cambiar las preguntas de todas las encuestas que usan un mismo conjunto? ' +
                'Edítalo en la pestaña <strong>Preguntas</strong>: el cambio se aplica a todas a la vez.</p>',
            buttons: [
                {label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'},
                {label: 'Cambiar preguntas', cls: 'ea-btn ea-btn-primary', onClick: function(m) {
                    runBulk('setquestions', {setid: Number(m.querySelector('#ea-q-set').value)});
                }}
            ]
        });
    }

    function openMore() {
        var list = ['anon_on', 'anon_off', 'chain_on', 'chain_off', 'movetoend'];
        modal({
            title: 'Más acciones',
            body: '<div class="ea-more">' + list.map(function(a) {
                return '<button type="button" class="ea-more-item" data-more="' + a + '"><strong>' + esc(BULK_LABELS[a]) +
                    '</strong><span>' + esc(BULK_HELP[a]) + '</span></button>';
            }).join('') + '</div>',
            buttons: [{label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'}]
        });
        modalEl.querySelectorAll('[data-more]').forEach(function(b) {
            b.addEventListener('click', function() {
                confirmBulk(b.getAttribute('data-more'));
            });
        });
    }

    function confirmBulk(action) {
        var info = selectionInfo();
        modal({
            title: BULK_LABELS[action],
            body: '<p>Se aplicará a <strong>' + plural(info.surveys, 'encuesta', 'encuestas') + '</strong> en ' +
                plural(info.courses, 'curso', 'cursos') + '.' + (info.without ? ' Los ' + info.without +
                ' módulos sin encuesta se omiten.' : '') + '</p>' +
                (BULK_HELP[action] ? '<p class="ea-muted">' + esc(BULK_HELP[action]) + '</p>' : ''),
            buttons: [
                {label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'},
                {label: 'Aplicar', cls: 'ea-btn ea-btn-primary', onClick: function() {
                    runBulk(action, {});
                }}
            ]
        });
    }

    function openDelete() {
        var info = selectionInfo();
        modal({
            title: 'Eliminar encuestas',
            body: '<div class="ea-alert ea-alert-error">Se eliminarán <strong>' + plural(info.surveys, 'encuesta', 'encuestas') +
                '</strong> con <strong>' + plural(info.responses, 'respuesta', 'respuestas') + '</strong>. ' +
                'Los módulos siguientes quedarán desbloqueados.</div>' +
                '<p>Si solo quieres que los estudiantes no la vean, usa <strong>Desactivar</strong>: conserva las respuestas.</p>' +
                '<label class="ea-field"><span>Escribe ELIMINAR para confirmar</span><input class="ea-input" id="ea-d-confirm" ' +
                'autocomplete="off"></label>',
            buttons: [
                {label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'},
                {label: 'Eliminar', cls: 'ea-btn ea-btn-danger', onClick: function(m) {
                    if (m.querySelector('#ea-d-confirm').value.trim().toUpperCase() !== 'ELIMINAR') {
                        m.querySelector('#ea-d-confirm').classList.add('ea-invalid');
                        return;
                    }
                    runBulk('delete', {});
                }}
            ]
        });
    }

    // ------------------------------------------------------------------ report view

    function loadReport(params, push) {
        if (push && S.view === 'report' && S.reportParams) {
            S.reportStack.push(S.reportParams);
        } else if (push) {
            S.reportStack = [];
        }
        S.view = 'report';
        S.reportParams = params;
        S.report = null;
        render();
        return api('report', params).then(function(data) {
            S.report = data;
            render();
        }).catch(function(e) {
            S.report = {error: e.message};
            render();
        });
    }

    function backLink() {
        var canBack = CFG.mode === 'full' || !CFG.mode || S.reportStack.length;
        if (!canBack) {
            return '';
        }
        var label = S.reportStack.length ? '← Volver al informe del curso' : '← Volver a cursos y módulos';
        return '<button type="button" class="ea-link ea-back ea-noprint" data-act="back">' + label + '</button>';
    }

    function renderReport() {
        var r = S.report;
        if (!r) {
            return backLink() + '<div class="ea-loading">Calculando estadísticas…</div>';
        }
        if (r.error) {
            return backLink() + '<div class="ea-alert ea-alert-error">' + esc(r.error) + '</div>';
        }
        return backLink() + (r.type === 'course' ? renderCourseReport(r) : renderModuleReport(r));
    }

    function groupSelect(r) {
        if (!r.groups || !r.groups.length) {
            return '';
        }
        return '<select class="ea-input ea-select" id="ea-group"><option value="0">Todos los grupos</option>' +
            r.groups.map(function(g) {
                return '<option value="' + g.id + '"' + (r.groupid === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
            }).join('') + '</select>';
    }

    function kpi(label, value, sub) {
        return '<div class="ea-kpi"><div class="ea-kpi-value">' + value + '</div><div class="ea-kpi-label">' + esc(label) + '</div>' +
            (sub ? '<div class="ea-kpi-sub">' + sub + '</div>' : '') + '</div>';
    }

    function satisfaction(v) {
        return v === null || v === undefined ? '—' : String(v).replace('.', ',') + '<small> / 5</small>';
    }

    function renderModuleReport(r) {
        var s = r.survey;
        var rate = pct(r.responded, r.enrolled);
        var html = '<div class="ea-report-head"><div><div class="ea-muted">' + esc(r.course.fullname) + ' · ' + esc(s.section) +
            '</div><h2>' + esc(s.name) + '</h2><div class="ea-chips">' +
            '<span class="ea-badge">' + (s.anonymous ? 'Anónima' : 'Identificada') + '</span>' +
            (s.mandatory ? '<span class="ea-badge ea-badge-strong">Obligatoria</span>' : '') +
            (!s.visible ? '<span class="ea-badge ea-badge-muted">Desactivada</span>' : '') +
            '<span class="ea-badge ea-badge-muted">Preguntas: ' + esc(s.setname) + '</span>' +
            '<span class="ea-muted ea-small">Generado: ' + esc(r.generated) + '</span></div></div>' +
            '<div class="ea-report-tools ea-noprint">' + groupSelect(r) +
            '<button type="button" class="ea-btn" data-act="print">Imprimir</button>' +
            '<button type="button" class="ea-btn" data-act="csv-results">CSV resultados</button>' +
            (!s.anonymous ? '<button type="button" class="ea-btn" data-act="csv-students">CSV por estudiante</button>' : '') +
            '<button type="button" class="ea-btn" data-act="csv-pending">CSV pendientes</button>' +
            '<a class="ea-btn ea-btn-ghost" href="' + esc(s.url) + '" target="_blank" rel="noopener">Abrir en Moodle</a>' +
            '</div></div>';
        r.notes.forEach(function(n) {
            html += '<div class="ea-alert">' + esc(n) + '</div>';
        });
        html += '<div class="ea-kpis">' +
            kpi('respondieron', r.responded + '<small> / ' + r.enrolled + '</small>',
                '<span class="ea-bar ea-bar-lg"><span style="width:' + Math.min(100, rate) + '%"></span></span>' + rate + '%') +
            kpi('faltan por responder', String(r.pending.length)) +
            kpi('satisfacción promedio', satisfaction(r.overall), 'preguntas con escala, normalizado a 5') +
            '</div>';
        html += '<h3 class="ea-h3">Resultados del módulo</h3>' + renderQuestions(r.questions, false);

        if (!s.anonymous) {
            html += renderStudentTable(r);
        } else {
            html += '<div class="ea-alert">Encuesta anónima: se muestran solo resultados colectivos y quién falta por responder.</div>';
        }
        html += '<h3 class="ea-h3 ea-page-break">Faltan por responder (' + r.pending.length + ')</h3>';
        if (!r.pending.length) {
            html += '<p class="ea-muted">Todos los estudiantes respondieron. 🎉</p>';
        } else {
            html += '<div class="ea-table-wrap"><table class="ea-table ea-table-compact"><thead><tr><th>#</th><th>Estudiante</th>' +
                '<th>Correo</th><th>Último acceso al curso</th></tr></thead><tbody>' +
                r.pending.map(function(p, i) {
                    return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.fullname) + '</td><td>' + esc(p.email) + '</td><td>' +
                        esc(p.lastaccess) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        return html;
    }

    function shortLabel(label) {
        var i = label.indexOf(':');
        return i > 0 && i < 60 ? label.slice(0, i) : (label.length > 40 ? label.slice(0, 40) + '…' : label);
    }

    function renderStudentTable(r) {
        var qs = r.questions;
        var html = '<h3 class="ea-h3 ea-page-break">Qué respondió cada estudiante (' + r.students.length + ')</h3>';
        if (!r.students.length) {
            return html + '<p class="ea-muted">Todavía no hay respuestas.</p>';
        }
        html += '<div class="ea-table-wrap"><table class="ea-table ea-table-compact ea-answers"><thead><tr><th>Estudiante</th><th>Fecha</th>' +
            qs.map(function(q, i) {
                return '<th title="' + esc(q.label) + '">P' + (i + 1) + '. ' + esc(shortLabel(q.label)) + '</th>';
            }).join('') + '</tr></thead><tbody>' +
            r.students.map(function(st) {
                return '<tr><td><div class="ea-strong">' + esc(st.fullname) + '</div><div class="ea-muted ea-small">' + esc(st.email) +
                    '</div></td><td class="ea-nowrap">' + esc(st.time) + '</td>' +
                    qs.map(function(q) {
                        var a = st.answers[String(q.id)];
                        return '<td>' + (a === undefined || a === '' ? '<span class="ea-muted">—</span>' : esc(a)) + '</td>';
                    }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
        return html;
    }

    function renderQuestions(questions, showModule) {
        if (!questions.length) {
            return '<p class="ea-muted">Sin preguntas.</p>';
        }
        return '<div class="ea-questions">' + questions.map(function(q, i) {
            var body = '';
            if (q.qtype === 'text') {
                if (!q.texts.length) {
                    body = '<p class="ea-muted">Sin respuestas.</p>';
                } else {
                    body = '<ul class="ea-texts">' + q.texts.map(function(t) {
                        var who = [t.who, showModule ? t.module : ''].filter(Boolean).join(' · ');
                        return '<li><span>' + esc(t.text) + '</span>' + (who ? '<em>— ' + esc(who) + '</em>' : '') + '</li>';
                    }).join('') + '</ul>';
                }
            } else {
                body = '<div class="ea-opts">' + q.options.map(function(o) {
                    return '<div class="ea-opt"><span class="ea-opt-label">' + esc(o.text) + '</span>' +
                        '<span class="ea-bar ea-bar-lg"><span style="width:' + o.pct + '%"></span></span>' +
                        '<span class="ea-opt-num">' + o.count + ' <small>(' + String(o.pct).replace('.', ',') + '%)</small></span></div>';
                }).join('') + '</div>';
                if (q.average !== null && q.average !== undefined) {
                    body += '<div class="ea-avg">Promedio: <strong>' + String(q.average).replace('.', ',') + '</strong> / ' + q.scale +
                        ' <span class="ea-muted ea-small">(primera opción = ' + q.scale + ')</span></div>';
                }
            }
            return '<div class="ea-qcard"><div class="ea-qhead"><span class="ea-qnum">P' + (i + 1) + '</span><div><div class="ea-qlabel">' +
                esc(q.label) + '</div><div class="ea-muted ea-small">' + QTYPES[q.qtype] + ' · ' + plural(q.answered, 'respuesta', 'respuestas') +
                (q.old ? ' · <span class="ea-badge ea-badge-warn">pregunta anterior</span>' : '') + '</div></div></div>' + body + '</div>';
        }).join('') + '</div>';
    }

    function renderCourseReport(r) {
        var totalResponded = 0;
        var totalPossible = 0;
        r.modules.forEach(function(m) {
            totalResponded += m.responded;
            totalPossible += m.enrolled;
        });
        var html = '<div class="ea-report-head"><div><div class="ea-muted">Informe consolidado del curso</div><h2>' +
            esc(r.course.fullname) + '</h2><div class="ea-chips"><span class="ea-badge">' + plural(r.modules.length, 'encuesta', 'encuestas') +
            '</span><span class="ea-muted ea-small">Generado: ' + esc(r.generated) + '</span></div></div>' +
            '<div class="ea-report-tools ea-noprint">' + groupSelect(r) +
            '<button type="button" class="ea-btn" data-act="print">Imprimir</button>' +
            '<button type="button" class="ea-btn" data-act="csv-modules">CSV por módulo</button>' +
            '<button type="button" class="ea-btn" data-act="csv-results">CSV resultados</button>' +
            '<a class="ea-btn ea-btn-ghost" href="' + esc(r.course.url) + '" target="_blank" rel="noopener">Abrir curso</a></div></div>';
        r.notes.forEach(function(n) {
            html += '<div class="ea-alert">' + esc(n) + '</div>';
        });
        html += '<div class="ea-kpis">' +
            kpi('estudiantes', String(r.enrolled)) +
            kpi('respuestas recibidas', String(r.responses)) +
            kpi('tasa de respuesta', pct(totalResponded, totalPossible) + '%', 'promedio de todos los módulos') +
            kpi('satisfacción promedio', satisfaction(r.overall), 'todas las encuestas del curso') +
            '</div>';
        html += '<h3 class="ea-h3">Respuesta por módulo</h3><div class="ea-table-wrap"><table class="ea-table"><thead><tr><th>Módulo</th>' +
            '<th>Encuesta</th><th>Respondieron</th><th>Faltan</th><th>Satisfacción</th><th class="ea-noprint"></th></tr></thead><tbody>' +
            r.modules.map(function(m) {
                var rate = pct(m.responded, m.enrolled);
                return '<tr><td class="ea-strong">' + esc(m.section) + '</td><td>' + esc(m.name) +
                    (!m.visible ? ' <span class="ea-badge ea-badge-muted">Desactivada</span>' : '') +
                    (m.anonymous ? ' <span class="ea-badge">Anónima</span>' : '') + '</td>' +
                    '<td><div class="ea-rate"><span>' + m.responded + ' / ' + m.enrolled + ' (' + rate + '%)</span>' +
                    '<span class="ea-bar"><span style="width:' + Math.min(100, rate) + '%"></span></span></div></td>' +
                    '<td>' + m.pending + '</td><td>' + satisfaction(m.overall) + '</td>' +
                    '<td class="ea-noprint"><button type="button" class="ea-btn ea-btn-sm" data-act="report" data-cmid="' + m.cmid +
                    '">Ver módulo</button></td></tr>';
            }).join('') + '</tbody></table></div>';
        html += '<h3 class="ea-h3 ea-page-break">Resultados de todos los módulos juntos</h3>' + renderQuestions(r.questions, true);
        return html;
    }

    // ------------------------------------------------------------------ CSV

    function csvCell(v) {
        v = String(v === null || v === undefined ? '' : v);
        if (/[;"\r\n]/.test(v)) {
            v = '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
    }

    function download(name, rows) {
        var csv = '﻿' + rows.map(function(r) {
            return r.map(csvCell).join(';');
        }).join('\r\n');
        var blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 500);
    }

    function fileBase(r) {
        var base = r.type === 'course' ? r.course.shortname : (r.course.shortname + '-' + r.survey.section);
        return norm(base).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'encuesta';
    }

    function csvResults(r) {
        var rows = [['Pregunta', 'Tipo', 'Opción / Respuesta', 'Cantidad', '%', 'Promedio', 'Estudiante', 'Módulo']];
        r.questions.forEach(function(q) {
            if (q.qtype === 'text') {
                q.texts.forEach(function(t) {
                    rows.push([q.label, QTYPES[q.qtype], t.text, '', '', '', t.who, t.module]);
                });
            } else {
                q.options.forEach(function(o, i) {
                    rows.push([q.label, QTYPES[q.qtype], o.text, o.count, String(o.pct).replace('.', ','),
                        i === 0 && q.average !== null ? String(q.average).replace('.', ',') : '', '', '']);
                });
            }
        });
        download(fileBase(r) + '-resultados.csv', rows);
    }

    function csvStudents(r) {
        var rows = [['Estudiante', 'Correo', 'Fecha'].concat(r.questions.map(function(q) {
            return q.label;
        }))];
        r.students.forEach(function(st) {
            rows.push([st.fullname, st.email, st.time].concat(r.questions.map(function(q) {
                var a = st.answers[String(q.id)];
                return a === undefined ? '' : a;
            })));
        });
        download(fileBase(r) + '-por-estudiante.csv', rows);
    }

    function csvPending(r) {
        var rows = [['Estudiante', 'Correo', 'Último acceso al curso']];
        r.pending.forEach(function(p) {
            rows.push([p.fullname, p.email, p.lastaccess]);
        });
        download(fileBase(r) + '-pendientes.csv', rows);
    }

    function csvModules(r) {
        var rows = [['Módulo', 'Encuesta', 'Respondieron', 'Estudiantes', '% respuesta', 'Faltan', 'Satisfacción (1-5)', 'Anónima',
            'Obligatoria']];
        r.modules.forEach(function(m) {
            rows.push([m.section, m.name, m.responded, m.enrolled, String(pct(m.responded, m.enrolled)).replace('.', ','),
                m.pending, m.overall === null ? '' : String(m.overall).replace('.', ','), m.anonymous ? 'Sí' : 'No',
                m.mandatory ? 'Sí' : 'No']);
        });
        download(fileBase(r) + '-por-modulo.csv', rows);
    }

    // ------------------------------------------------------------------ question sets

    function loadSets() {
        return api('sets').then(function(data) {
            S.sets = data.sets;
            render();
        }).catch(function(e) {
            S.error = e.message;
            render();
        });
    }

    function renderSets() {
        if (!S.sets) {
            return '<div class="ea-loading">Cargando preguntas…</div>';
        }
        var edit = !!CFG.canedit;
        var html = '<div class="ea-intro"><div><h2>Conjuntos de preguntas</h2><p>Cada encuesta usa un conjunto. Si editas un conjunto, ' +
            'el cambio se aplica de inmediato a <strong>todas</strong> las encuestas que lo usan. Para cambiar las preguntas solo en ' +
            'algunos cursos o módulos, crea otro conjunto y asígnalo desde «Cursos y módulos» → «Cambiar preguntas».</p></div>' +
            (edit ? '<button type="button" class="ea-btn ea-btn-primary" data-act="newset">+ Nuevo conjunto</button>' : '') + '</div>';
        html += '<div class="ea-sets">' + S.sets.map(function(st) {
            return '<div class="ea-set"><div class="ea-set-head"><div><h3>' + esc(st.name) +
                (st.isdefault ? ' <span class="ea-badge">Predeterminado</span>' : '') + '</h3><div class="ea-muted ea-small">' +
                plural(st.questions.length, 'pregunta', 'preguntas') + ' · usado en ' + plural(st.surveys, 'encuesta', 'encuestas') +
                ' de ' + plural(st.courses, 'curso', 'cursos') + '</div></div><div class="ea-set-btns">' +
                (edit ? '<button type="button" class="ea-btn ea-btn-sm" data-act="editset" data-set="' + st.id + '">Editar</button>' +
                    '<button type="button" class="ea-btn ea-btn-sm ea-btn-ghost" data-act="dupset" data-set="' + st.id + '">Duplicar</button>' +
                    (st.surveys ? '' : '<button type="button" class="ea-btn ea-btn-sm ea-btn-ghost ea-danger-text" data-act="delset" data-set="' +
                        st.id + '">Eliminar</button>') : '') +
                '</div></div><ol class="ea-set-qs">' + st.questions.map(function(q) {
                    return '<li>' + esc(q.label) + (q.required ? ' <span class="ea-req">*</span>' : '') + '<div class="ea-muted ea-small">' +
                        QTYPES[q.qtype] + (q.options.length ? ': ' + esc(q.options.join(' · ')) : '') + '</div></li>';
                }).join('') + '</ol></div>';
        }).join('') + '</div>';
        return html;
    }

    function blankQuestion() {
        return {id: 0, qtype: 'single', label: '', options: [], optionsText: '', required: 1, scored: 1};
    }

    function startEdit(set) {
        var copy = JSON.parse(JSON.stringify(set || {id: 0, name: '', intro: '', questions: [blankQuestion()]}));
        copy.questions.forEach(function(q) {
            q.optionsText = (q.options || []).join('\n');
        });
        copy.surveys = set ? set.surveys : 0;
        S.editing = copy;
        render();
    }

    function renderSetEditor() {
        var st = S.editing;
        var html = '<button type="button" class="ea-link ea-back" data-act="canceledit">← Volver a conjuntos</button>' +
            '<div class="ea-editor"><h2>' + (st.id ? 'Editar conjunto' : 'Nuevo conjunto de preguntas') + '</h2>';
        if (st.id && st.surveys) {
            html += '<div class="ea-alert">Este conjunto lo usan <strong>' + plural(st.surveys, 'encuesta', 'encuestas') +
                '</strong>. Al guardar, el cambio se verá en todas. Las respuestas ya recibidas se conservan.</div>';
        }
        html += '<label class="ea-field"><span>Nombre del conjunto</span><input class="ea-input" data-bind="name" value="' +
            esc(st.name) + '"></label>' +
            '<label class="ea-field"><span>Texto de bienvenida (se muestra arriba de las preguntas)</span><textarea class="ea-input" rows="4" ' +
            'data-bind="intro">' + esc(st.intro) + '</textarea></label>' +
            '<h3 class="ea-h3">Preguntas</h3>';
        html += st.questions.map(function(q, i) {
            return '<div class="ea-qedit"><div class="ea-qedit-head"><span class="ea-qnum">P' + (i + 1) + '</span>' +
                '<select class="ea-input ea-select" data-q="' + i + '" data-qf="qtype">' + Object.keys(QTYPES).map(function(t) {
                    return '<option value="' + t + '"' + (q.qtype === t ? ' selected' : '') + '>' + QTYPES[t] + '</option>';
                }).join('') + '</select>' +
                '<label class="ea-inline"><input type="checkbox" data-q="' + i + '" data-qf="required"' + (q.required ? ' checked' : '') +
                '> Obligatoria</label>' +
                (q.qtype === 'single' ? '<label class="ea-inline" title="Calcula un promedio: la primera opción vale más"><input type="checkbox" data-q="' +
                    i + '" data-qf="scored"' + (q.scored ? ' checked' : '') + '> Calcular promedio</label>' : '') +
                '<span class="ea-spacer"></span>' +
                '<button type="button" class="ea-icon-btn" data-act="qup" data-q="' + i + '" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
                '<button type="button" class="ea-icon-btn" data-act="qdown" data-q="' + i + '" title="Bajar"' +
                (i === st.questions.length - 1 ? ' disabled' : '') + '>↓</button>' +
                '<button type="button" class="ea-icon-btn ea-danger-text" data-act="qdel" data-q="' + i + '" title="Eliminar pregunta">✕</button>' +
                '</div><textarea class="ea-input" rows="2" placeholder="Texto de la pregunta" data-q="' + i + '" data-qf="label">' +
                esc(q.label) + '</textarea>' +
                (q.qtype !== 'text' ? '<label class="ea-field ea-field-tight"><span>Opciones (una por línea' +
                    (q.qtype === 'single' ? ', de la mejor a la peor si calculas promedio' : '') + ')</span><textarea class="ea-input" rows="' +
                    Math.max(3, (q.optionsText.split('\n').length + 1)) + '" data-q="' + i + '" data-qf="optionsText">' + esc(q.optionsText) +
                    '</textarea></label>' : '') + '</div>';
        }).join('');
        html += '<button type="button" class="ea-btn" data-act="qadd">+ Agregar pregunta</button>' +
            '<div class="ea-editor-foot"><button type="button" class="ea-btn ea-btn-ghost" data-act="canceledit">Cancelar</button>' +
            '<button type="button" class="ea-btn ea-btn-primary" data-act="saveset">Guardar conjunto</button></div></div>';
        return html;
    }

    function saveSet() {
        var st = S.editing;
        var payload = {
            id: st.id,
            name: st.name,
            intro: st.intro,
            questions: st.questions.map(function(q) {
                return {
                    id: q.id || 0,
                    qtype: q.qtype,
                    label: q.label,
                    options: q.qtype === 'text' ? [] : q.optionsText.split('\n'),
                    required: q.required ? 1 : 0,
                    scored: q.scored ? 1 : 0
                };
            })
        };
        busy('Guardando…');
        api('saveset', {set: payload}).then(function() {
            closeModal();
            S.editing = null;
            toast('Conjunto guardado');
            S.overview = null;
            reloadOverview(false);
            return loadSets();
        }).catch(function(e) {
            alertModal('No se pudo guardar', e.message);
        });
    }

    // ------------------------------------------------------------------ users (subdomain panel)

    function loadUsers() {
        return api('users_list').then(function(data) {
            S.users = data.users;
            render();
        }).catch(function(e) {
            S.error = e.message;
            render();
        });
    }

    function renderUsers() {
        if (!S.users) {
            return '<div class="ea-loading">Cargando usuarios…</div>';
        }
        return '<div class="ea-intro"><div><h2>Usuarios del panel</h2><p><strong>Administrador</strong>: todo (acciones masivas, preguntas, ' +
            'usuarios). <strong>Solo lectura</strong>: ve cursos, informes y preguntas, sin cambiar nada.</p></div>' +
            '<button type="button" class="ea-btn ea-btn-primary" data-act="useradd">+ Nuevo usuario</button></div>' +
            '<div class="ea-table-wrap"><table class="ea-table"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Último ingreso</th><th></th>' +
            '</tr></thead><tbody>' + S.users.map(function(u) {
                return '<tr><td class="ea-strong">' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td>' +
                    (u.role === 'admin' ? 'Administrador' : 'Solo lectura') + '</td><td class="ea-small">' + esc(u.lastlogin || '—') +
                    '</td><td class="ea-nowrap"><button type="button" class="ea-btn ea-btn-sm" data-act="useredit" data-user="' +
                    esc(u.username) + '">Editar</button> <button type="button" class="ea-btn ea-btn-sm ea-btn-ghost ea-danger-text" ' +
                    'data-act="userdel" data-user="' + esc(u.username) + '">Eliminar</button></td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    function userForm(u) {
        var isNew = !u;
        u = u || {username: '', name: '', role: 'viewer'};
        modal({
            title: isNew ? 'Nuevo usuario' : 'Editar ' + u.username,
            body: (isNew ? '<label class="ea-field"><span>Usuario</span><input class="ea-input" id="ea-u-username" autocomplete="off"></label>' : '') +
                '<label class="ea-field"><span>Nombre</span><input class="ea-input" id="ea-u-name" value="' + esc(u.name) + '"></label>' +
                '<label class="ea-field"><span>Rol</span><select class="ea-input" id="ea-u-role">' +
                '<option value="viewer"' + (u.role !== 'admin' ? ' selected' : '') + '>Solo lectura</option>' +
                '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Administrador</option></select></label>' +
                '<label class="ea-field"><span>' + (isNew ? 'Contraseña' : 'Nueva contraseña (vacío = no cambiar)') +
                '</span><input class="ea-input" type="password" id="ea-u-pass" autocomplete="new-password"><small>Mínimo 8 caracteres.</small></label>',
            buttons: [
                {label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'},
                {label: 'Guardar', cls: 'ea-btn ea-btn-primary', onClick: function(m) {
                    var data = {
                        isnew: isNew ? 1 : 0,
                        username: isNew ? m.querySelector('#ea-u-username').value : u.username,
                        name: m.querySelector('#ea-u-name').value,
                        role: m.querySelector('#ea-u-role').value,
                        password: m.querySelector('#ea-u-pass').value
                    };
                    api('users_save', data).then(function(res) {
                        closeModal();
                        S.users = res.users;
                        render();
                        toast('Usuario guardado');
                    }).catch(function(e) {
                        alertModal('No se pudo guardar', e.message);
                    });
                }}
            ]
        });
    }

    // ------------------------------------------------------------------ data

    function reloadOverview(silent) {
        if (!CFG.canedit && CFG.mode !== 'full' && CFG.mode) {
            return Promise.resolve();
        }
        return api('overview').then(function(data) {
            S.overview = data;
            // Drop selections of sections that no longer exist.
            var exists = {};
            data.courses.forEach(function(c) {
                c.sections.forEach(function(s) {
                    exists[s.id] = true;
                });
            });
            Object.keys(S.selected).forEach(function(id) {
                if (!exists[id]) {
                    delete S.selected[id];
                }
            });
            if (S.view === 'courses') {
                render();
            }
        }).catch(function(e) {
            if (!silent) {
                S.error = e.message;
                render();
            }
        });
    }

    function findSet(id) {
        return (S.sets || []).filter(function(s) {
            return s.id === Number(id);
        })[0];
    }

    // ------------------------------------------------------------------ events

    var actions = {
        tab: function(el) {
            S.view = el.getAttribute('data-tab');
            S.error = '';
            S.editing = null;
            render();
            if (S.view === 'sets' && !S.sets) {
                loadSets();
            }
            if (S.view === 'users' && !S.users) {
                loadUsers();
            }
            if (S.view === 'courses' && !S.overview) {
                reloadOverview(false);
            }
        },
        toggle: function(el) {
            var id = el.getAttribute('data-course');
            S.expanded[id] = !S.expanded[id];
            refreshCourseList();
        },
        expandall: function() {
            visibleCourses().forEach(function(c) {
                S.expanded[c.id] = true;
            });
            refreshCourseList();
        },
        collapseall: function() {
            S.expanded = {};
            refreshCourseList();
        },
        reload: function() {
            reloadOverview(false).then(function() {
                toast('Actualizado');
            });
        },
        selsection: function(el) {
            var id = el.getAttribute('data-section');
            if (el.checked) {
                S.selected[id] = Number(el.getAttribute('data-course'));
            } else {
                delete S.selected[id];
            }
            refreshCourseList();
        },
        selcourse: function(el) {
            var cid = Number(el.getAttribute('data-course'));
            var course = S.overview.courses.filter(function(c) {
                return c.id === cid;
            })[0];
            visibleSections(course).forEach(function(s) {
                if (el.checked) {
                    S.selected[s.id] = cid;
                } else {
                    delete S.selected[s.id];
                }
            });
            if (el.checked) {
                S.expanded[cid] = true;
            }
            refreshCourseList();
        },
        selectfiltered: function() {
            visibleCourses().forEach(function(c) {
                visibleSections(c).forEach(function(s) {
                    S.selected[s.id] = c.id;
                });
                S.expanded[c.id] = true;
            });
            refreshCourseList();
            if (!S.qSection) {
                toast('Se seleccionaron todas las secciones. Usa el filtro de módulos para afinar (ej: Modulo).');
            }
        },
        clearsel: function() {
            S.selected = {};
            refreshCourseList();
        },
        'bulk-create': openCreate,
        'bulk-questions': openQuestions,
        'bulk-more': openMore,
        'bulk-delete': openDelete,
        bulk: function(el) {
            confirmBulk(el.getAttribute('data-bulk'));
        },
        report: function(el) {
            loadReport({cmid: Number(el.getAttribute('data-cmid'))}, true);
        },
        coursereport: function(el) {
            loadReport({courseid: Number(el.getAttribute('data-course'))}, true);
        },
        back: function() {
            if (S.reportStack.length) {
                var prev = S.reportStack.pop();
                loadReport(prev, false);
                return;
            }
            S.view = 'courses';
            S.report = null;
            render();
            if (!S.overview) {
                reloadOverview(false);
            }
        },
        print: function() {
            window.print();
        },
        'csv-results': function() {
            csvResults(S.report);
        },
        'csv-students': function() {
            csvStudents(S.report);
        },
        'csv-pending': function() {
            csvPending(S.report);
        },
        'csv-modules': function() {
            csvModules(S.report);
        },
        newset: function() {
            startEdit(null);
        },
        editset: function(el) {
            startEdit(findSet(el.getAttribute('data-set')));
        },
        dupset: function(el) {
            api('duplicateset', {id: Number(el.getAttribute('data-set'))}).then(function() {
                toast('Conjunto duplicado');
                S.overview = null;
                reloadOverview(true);
                return loadSets();
            }).catch(function(e) {
                alertModal('No se pudo duplicar', e.message);
            });
        },
        delset: function(el) {
            var st = findSet(el.getAttribute('data-set'));
            modal({
                title: 'Eliminar conjunto',
                body: '<p>¿Eliminar el conjunto <strong>' + esc(st.name) + '</strong>?</p>',
                buttons: [{label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'}, {label: 'Eliminar', cls: 'ea-btn ea-btn-danger', onClick: function() {
                    api('deleteset', {id: st.id}).then(function() {
                        closeModal();
                        toast('Conjunto eliminado');
                        reloadOverview(true);
                        return loadSets();
                    }).catch(function(e) {
                        alertModal('No se pudo eliminar', e.message);
                    });
                }}]
            });
        },
        canceledit: function() {
            S.editing = null;
            render();
        },
        qadd: function() {
            S.editing.questions.push(blankQuestion());
            render();
        },
        qdel: function(el) {
            S.editing.questions.splice(Number(el.getAttribute('data-q')), 1);
            render();
        },
        qup: function(el) {
            var i = Number(el.getAttribute('data-q'));
            var q = S.editing.questions;
            q.splice(i - 1, 0, q.splice(i, 1)[0]);
            render();
        },
        qdown: function(el) {
            var i = Number(el.getAttribute('data-q'));
            var q = S.editing.questions;
            q.splice(i + 1, 0, q.splice(i, 1)[0]);
            render();
        },
        saveset: saveSet,
        useradd: function() {
            userForm(null);
        },
        useredit: function(el) {
            var name = el.getAttribute('data-user');
            userForm(S.users.filter(function(u) {
                return u.username === name;
            })[0]);
        },
        userdel: function(el) {
            var name = el.getAttribute('data-user');
            modal({
                title: 'Eliminar usuario',
                body: '<p>¿Eliminar el usuario <strong>' + esc(name) + '</strong>?</p>',
                buttons: [{label: 'Cancelar', cls: 'ea-btn ea-btn-ghost'}, {label: 'Eliminar', cls: 'ea-btn ea-btn-danger', onClick: function() {
                    api('users_delete', {username: name}).then(function(res) {
                        closeModal();
                        S.users = res.users;
                        render();
                    }).catch(function(e) {
                        alertModal('No se pudo eliminar', e.message);
                    });
                }}]
            });
        }
    };

    function onClick(e) {
        var el = e.target.closest('[data-act]');
        if (!el || !root.contains(el)) {
            return;
        }
        var fn = actions[el.getAttribute('data-act')];
        if (fn) {
            if (el.tagName !== 'INPUT') {
                e.preventDefault();
            }
            fn(el, e);
        }
    }

    function onInput(e) {
        var el = e.target;
        if (el.id === 'ea-qcourse') {
            S.qCourse = el.value;
            refreshCourseList();
        } else if (el.id === 'ea-qsection') {
            S.qSection = el.value;
            refreshCourseList();
        } else if (S.editing && el.hasAttribute('data-bind')) {
            S.editing[el.getAttribute('data-bind')] = el.value;
        } else if (S.editing && el.hasAttribute('data-qf')) {
            var q = S.editing.questions[Number(el.getAttribute('data-q'))];
            var f = el.getAttribute('data-qf');
            if (el.type === 'checkbox') {
                q[f] = el.checked ? 1 : 0;
            } else {
                q[f] = el.value;
            }
        }
    }

    function onChange(e) {
        var el = e.target;
        if (el.id === 'ea-show') {
            S.show = el.value;
            refreshCourseList();
        } else if (el.id === 'ea-group') {
            var params = Object.assign({}, S.reportParams, {groupid: Number(el.value)});
            loadReport(params, false);
        } else if (S.editing && el.getAttribute('data-qf') === 'qtype') {
            var q = S.editing.questions[Number(el.getAttribute('data-q'))];
            q.qtype = el.value;
            if (q.qtype !== 'single') {
                q.scored = 0;
            }
            render();
        } else if (S.editing && el.type === 'checkbox' && el.hasAttribute('data-qf')) {
            onInput(e);
        }
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modalEl && modalEl.querySelector('[data-mclose]')) {
            closeModal();
        }
    });

    // ------------------------------------------------------------------ boot

    function boot() {
        root = document.getElementById('encuestas-app');
        if (!root) {
            return;
        }
        root.classList.add('ea-root');
        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        if (CFG.mode === 'report') {
            loadReport({cmid: CFG.cmid}, false);
        } else if (CFG.mode === 'coursereport') {
            loadReport({courseid: CFG.courseid}, false);
        } else {
            S.view = 'courses';
            render();
            reloadOverview(false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
