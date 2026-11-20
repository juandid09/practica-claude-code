<?php
/**
 * Conexión directa panel -> Moodle (sin HTTP).
 *
 * Cuando el panel y Moodle están en el mismo servidor, el panel carga Moodle desde su carpeta y llama
 * al plugin en el mismo proceso PHP. Así no pasa por el firewall / anti-bot del hosting.
 *
 * Este archivo se incluye desde el ámbito global (api.php / diagnostico.php), nunca dentro de una función,
 * porque config.php de Moodle crea variables globales.
 */
if (!defined('PANEL')) {
    http_response_code(404);
    exit;
}

// Moodle redirige las peticiones que no vienen a su propia dirección: presentamos esta como una petición a Moodle.
$panelbridgeurl = parse_url(rtrim(MOODLE_URL, '/') . '/');
$_SERVER['HTTP_HOST'] = $panelbridgeurl['host'] . (isset($panelbridgeurl['port']) ? ':' . $panelbridgeurl['port'] : '');
$_SERVER['SERVER_NAME'] = $panelbridgeurl['host'];
if (isset($panelbridgeurl['port'])) {
    $_SERVER['SERVER_PORT'] = (string) $panelbridgeurl['port'];
}
if (($panelbridgeurl['scheme'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
$_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $_SERVER['REQUEST_URI'] =
    rtrim($panelbridgeurl['path'] ?? '/', '/') . '/mod/encuestamod/api.php';
unset($panelbridgeurl);

define('NO_MOODLE_COOKIES', true);
define('AJAX_SCRIPT', true);
define('NO_DEBUG_DISPLAY', true);

require panel_moodle_dir() . '/config.php';

/**
 * Llama al servicio del plugin como administrador del sitio.
 */
function panel_bridge_call(string $action, array $payload): array {
    global $PAGE;
    if (!class_exists('\mod_encuestamod\local\service')) {
        throw new RuntimeException('El plugin "Encuesta de módulo" no está instalado en ese Moodle.');
    }
    \core\session\manager::set_user(get_admin());
    $PAGE->set_context(\context_system::instance());
    return \mod_encuestamod\local\service::call($action, $payload);
}
