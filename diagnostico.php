<?php
/**
 * Diagnóstico de la conexión panel -> Moodle. Solo para administradores del panel
 * (o, si todavía no hay usuarios creados, para quien tenga acceso al servidor).
 */
define('PANEL', 1);
require __DIR__ . '/lib.php';

$users = panel_users();
$user = $users ? panel_current_user() : null;
if ($users && (!$user || ($user['role'] ?? '') !== 'admin')) {
    header('Location: ./');
    exit;
}
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
@set_time_limit(120);

function diag_short(string $body): string {
    $t = trim(preg_replace('/\s+/', ' ', strip_tags($body)));
    return $t === '' ? '(respuesta vacía)' : mb_substr($t, 0, 180);
}

function diag_row(string $name, $code, string $server, string $detail, ?bool $ok): void {
    echo '<tr><td>' . panel_h($name) . '</td><td>' . ($code ? (int) $code : '—') . '</td><td>' . panel_h($server) .
        '</td><td>' . panel_h($detail) . '</td><td class="' . ($ok === null ? '' : ($ok ? 'ok' : 'bad')) . '">' .
        ($ok === null ? '' : ($ok ? '✔' : '✘')) . "</td></tr>\n";
}

$host = (string) parse_url(MOODLE_URL, PHP_URL_HOST);
$moodledir = panel_moodle_dir();
?><!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagnóstico del panel</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f7f8f5;color:#1f2328;margin:0;padding:2rem}
main{max-width:960px;margin:auto}h1{font-size:1.4rem}h2{font-size:1.05rem;margin:1.6rem 0 .6rem}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e5df}
td,th{padding:.55rem .7rem;border-bottom:1px solid #eef0ec;text-align:left;vertical-align:top;font-size:.92rem}
th{background:#fbfbf9;font-size:.78rem;text-transform:uppercase;color:#667085}
.ok{color:#2f7a3e;font-weight:700}.bad{color:#b42318;font-weight:700}
.box{padding:1rem;border-radius:10px;margin:1rem 0;font-size:1rem}.box.ok{background:#e7f4ea}.box.bad{background:#fdecea}
.box.warn{background:#fff4dc;color:#9a6200}code{background:#eef0ea;padding:.1rem .3rem;border-radius:4px}a{color:#4a5240;font-weight:600}
</style></head><body><main>
<h1>Diagnóstico: panel → Moodle</h1>
<p>Moodle: <code><?= panel_h(MOODLE_URL) ?></code> · IP de este servidor: <code><?= panel_h($_SERVER['SERVER_ADDR'] ?? '?') ?></code>
· IP de <?= panel_h($host) ?>: <code><?= panel_h($host ? gethostbyname($host) : '?') ?></code><br>
Carpeta de Moodle en este servidor: <code><?= $moodledir !== '' ? panel_h($moodledir) : 'no encontrada' ?></code>
<?php if (defined('MOODLE_PATH') && MOODLE_PATH !== ''): ?>(definida en la configuración)<?php endif; ?><br>
PHP de este panel: <code><?= panel_h(PHP_VERSION) ?></code></p>

<h2>1. Conexión por internet (servicio web)</h2>
<table><tr><th>Prueba</th><th>HTTP</th><th>Servidor</th><th>Respuesta</th><th></th></tr>
<?php
[$c, $b, $srv, $e] = panel_http(rtrim(MOODLE_URL, '/') . '/login/index.php', null);
$homeok = $c >= 200 && $c < 400;
diag_row('Página de inicio de Moodle', $c, $srv, $e ?: diag_short($b), $homeok);
[$c, $b, $srv, $e] = panel_http(panel_ws_url(), 'moodlewsrestformat=json');
$wsok = strpos($b, '"errorcode"') !== false;
diag_row('Servicio web (sin token)', $c, $srv, $e ?: diag_short($b), $wsok);
$httpping = null;
$httperr = '';
if (MOODLE_TOKEN !== '') {
    try {
        $httpping = panel_moodle_call('ping', []);
    } catch (Throwable $ex) {
        $httperr = $ex->getMessage();
    }
    diag_row('Llamada con el token', $httpping ? 200 : 0, '', $httpping ? 'OK' : $httperr, (bool) $httpping);
} else {
    diag_row('Llamada con el token', 0, '', 'Sin token en config.local.php (no hace falta con la conexión directa)', null);
}
?>
</table>

<h2>2. Conexión directa (mismo servidor, sin pasar por el firewall)</h2>
<?php
if ($moodledir === '') {
    echo '<div class="box ' . ($httpping ? 'ok' : 'bad') . '">';
    if ($httpping) {
        echo 'No se encontró la carpeta de Moodle en este servidor, pero la conexión por servicio web funciona: el panel ya puede trabajar.';
    } else {
        echo 'No se encontró la carpeta de Moodle. Escríbela en <code>config.local.php</code>, en <code>MOODLE_PATH</code>: es la carpeta que ' .
            'contiene el <code>config.php</code> de Moodle. En SiteGround suele ser <code>/home/customer/www/' . panel_h($host) .
            '/public_html</code> (en Site Tools > Administrador de archivos verás la ruta exacta).';
        if (!$homeok) {
            echo '<br><br>La conexión por internet está bloqueada por el firewall / anti-bot del hosting, así que la conexión directa es ' .
                'la mejor opción. Si Moodle está en otro servidor, pide al soporte del hosting que permita las peticiones desde la IP ' .
                panel_h($_SERVER['SERVER_ADDR'] ?? '') . '.';
        }
    }
    echo '</div><p><a href="./">← Volver al panel</a></p></main></body></html>';
    exit;
}
@ob_flush();
@flush();

// Si Moodle se detiene al cargar, al menos se muestra qué pasó.
register_shutdown_function(function () {
    if (empty($GLOBALS['PANEL_DIAG_DONE'])) {
        $err = error_get_last();
        echo '<div class="box bad">Moodle se detuvo al cargarlo desde el panel' .
            ($err ? ': ' . panel_h($err['message'] . ' (' . basename($err['file']) . ':' . $err['line'] . ')') : '.') .
            ' Revisa que el subdominio use la misma versión de PHP que Moodle y que no haya restricción open_basedir entre carpetas.</div>' .
            '<p><a href="./">← Volver al panel</a></p></main></body></html>';
    }
});

$GLOBALS['PANEL_DIAG'] = ['ping' => null, 'error' => ''];
try {
    require __DIR__ . '/moodle-bridge.php';
    $GLOBALS['PANEL_DIAG']['ping'] = panel_bridge_call('ping', []);
} catch (Throwable $panelex) {
    $GLOBALS['PANEL_DIAG']['error'] = $panelex->getMessage();
}
$GLOBALS['PANEL_DIAG_DONE'] = true;
$panelping = $GLOBALS['PANEL_DIAG']['ping'];
if ($panelping) {
    echo '<div class="box ok">Conexión directa funcionando: ' . panel_h($panelping['site'] ?? '') . ' · Moodle ' .
        panel_h($GLOBALS['CFG']->release ?? '') . '. El panel ya usa esta conexión; no necesita token ni pasar por el firewall. ' .
        '<a href="./">Volver al panel</a></div>';
} else {
    echo '<div class="box bad">La conexión directa falló: ' . panel_h($GLOBALS['PANEL_DIAG']['error']) . '</div>';
}
echo '<p><a href="./">← Volver al panel</a></p></main></body></html>';
