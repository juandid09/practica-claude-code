<?php
/**
 * Configuración del panel de encuestas (subdominio).
 *
 * Si el panel está en el mismo servidor que Moodle (lo normal), basta con MOODLE_URL: el panel encuentra
 * la carpeta de Moodle y se conecta directamente. Revisa diagnostico.php para confirmarlo.
 * Si Moodle está en otro servidor: en Moodle entra a Administración del sitio > Cursos >
 * "Conectar panel de encuestas (subdominio)", pulsa el botón y copia el token en config.local.php (ver config.local.example.php).
 */
if (!defined('PANEL')) {
    http_response_code(404);
    exit;
}

// Los valores sensibles (token y carpeta de Moodle) van en config.local.php, que no se sube al
// repositorio, o en variables de entorno. Copia config.local.example.php como config.local.php.
// Lo que defina config.local.php tiene prioridad; después, las variables de entorno; al final,
// los valores por defecto de este archivo.
if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

/**
 * Define una constante si config.local.php no la definió, usando la variable de entorno o el valor por defecto.
 */
function panel_config(string $name, string $default): void {
    if (defined($name)) {
        return;
    }
    $env = getenv('PANEL_' . $name);
    define($name, ($env !== false && $env !== '') ? $env : $default);
}

// Dirección de tu Moodle, sin "/" al final.
panel_config('MOODLE_URL', 'https://cargodeti.com');

// Token del servicio "Panel de encuestas de módulo" (solo se usa si Moodle está en OTRO servidor).
// No lo escribas aquí: ponlo en config.local.php o en la variable de entorno PANEL_MOODLE_TOKEN.
panel_config('MOODLE_TOKEN', '');


// Carpeta de Moodle en este servidor (la que contiene su config.php), por ejemplo
// '/home/customer/www/cargodeti.com/public_html'. Déjalo vacío para que el panel la busque solo.
// Con la carpeta, el panel habla con Moodle directamente y no pasa por el firewall del hosting.
// Pon 'off' para usar siempre la conexión por servicio web (token).
panel_config('MOODLE_PATH', '');

// Título que se ve en el panel.
define('PANEL_TITLE', 'SAPS · Encuestas de módulo');

// Carpeta donde se guardan los usuarios del panel (debe poder escribir PHP).
// Si tu hosting lo permite, muévela fuera de la carpeta pública y pon aquí la ruta completa.
define('PANEL_DATA_DIR', __DIR__ . '/data');

// Minutos de inactividad antes de pedir otra vez la contraseña.
define('PANEL_SESSION_MINUTES', 240);
