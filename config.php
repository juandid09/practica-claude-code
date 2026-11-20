<?php
/**
 * Configuración del panel de encuestas (subdominio).
 *
 * Si el panel está en el mismo servidor que Moodle (lo normal), basta con MOODLE_URL: el panel encuentra
 * la carpeta de Moodle y se conecta directamente. Revisa diagnostico.php para confirmarlo.
 * Si Moodle está en otro servidor: en Moodle entra a Administración del sitio > Cursos >
 * "Conectar panel de encuestas (subdominio)", pulsa el botón y copia aquí MOODLE_URL y MOODLE_TOKEN.
 */
if (!defined('PANEL')) {
    http_response_code(404);
    exit;
}

// Dirección de tu Moodle, sin "/" al final.
//define('MOODLE_URL', 'https://cargodeti.com');

// Token del servicio "Panel de encuestas de módulo" (solo se usa si Moodle está en OTRO servidor).
//define('MOODLE_TOKEN', '');

define('MOODLE_URL', 'https://cargodeti.com');
define('MOODLE_TOKEN', ''); // No subir el token real al repositorio.


// Carpeta de Moodle en este servidor (la que contiene su config.php), por ejemplo
// '/home/customer/www/cargodeti.com/public_html'. Déjalo vacío para que el panel la busque solo.
// Con la carpeta, el panel habla con Moodle directamente y no pasa por el firewall del hosting.
// Pon 'off' para usar siempre la conexión por servicio web (token).
define('MOODLE_PATH', '');

// Título que se ve en el panel.
define('PANEL_TITLE', 'SAPS · Encuestas de módulo');

// Carpeta donde se guardan los usuarios del panel (debe poder escribir PHP).
// Si tu hosting lo permite, muévela fuera de la carpeta pública y pon aquí la ruta completa.
define('PANEL_DATA_DIR', __DIR__ . '/data');

// Minutos de inactividad antes de pedir otra vez la contraseña.
define('PANEL_SESSION_MINUTES', 240);
