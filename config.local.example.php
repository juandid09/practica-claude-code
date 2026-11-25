<?php
/**
 * Copia este archivo como config.local.php y pon aquí los valores reales.
 * config.local.php está en .gitignore: nunca se sube al repositorio.
 * Solo define lo que necesites; lo demás toma el valor por defecto de config.php.
 */
if (!defined('PANEL')) {
    http_response_code(404);
    exit;
}

// Token del servicio "Panel de encuestas de módulo" (solo si Moodle está en OTRO servidor).
// define('MOODLE_TOKEN', 'pega-aqui-el-token-de-moodle');

// Carpeta de Moodle en este servidor, si el panel no la encuentra solo.
// define('MOODLE_PATH', '/home/customer/www/cargodeti.com/public_html');
