<?php
/**
 * Funciones del panel de encuestas (subdominio).
 *
 * Los usuarios del panel son propios (no son usuarios de Moodle). El panel habla con Moodle
 * mediante el servicio web del plugin mod_encuestamod usando el token de config.php.
 */
if (!defined('PANEL')) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';

const PANEL_ROLES = ['admin' => 'Administrador', 'viewer' => 'Solo lectura'];
const PANEL_READ_ACTIONS = ['ping', 'overview', 'report', 'sets'];
const PANEL_WRITE_ACTIONS = ['bulk', 'saveset', 'duplicateset', 'deleteset'];
const PANEL_MAX_ATTEMPTS = 6;
const PANEL_LOCK_MINUTES = 15;

// ------------------------------------------------------------------ sesión

function panel_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('encuestas_panel');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
    }
}

/**
 * Usuario conectado o null (también cierra sesiones inactivas).
 */
function panel_current_user(): ?array {
    panel_session_start();
    if (empty($_SESSION['user'])) {
        return null;
    }
    if (time() - ($_SESSION['last'] ?? 0) > PANEL_SESSION_MINUTES * 60) {
        $_SESSION = [];
        session_regenerate_id(true);
        return null;
    }
    $users = panel_users();
    $u = $users[$_SESSION['user']] ?? null;
    if (!$u) {
        $_SESSION = [];
        return null;
    }
    $_SESSION['last'] = time();
    return ['username' => $_SESSION['user']] + $u;
}

function panel_logout(): void {
    panel_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 3600, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

// ------------------------------------------------------------------ almacenamiento (archivos .php que no se pueden leer desde la web)

function panel_data_path(string $name): string {
    if (!is_dir(PANEL_DATA_DIR)) {
        @mkdir(PANEL_DATA_DIR, 0750, true);
    }
    return rtrim(PANEL_DATA_DIR, '/') . '/' . $name . '.php';
}

function panel_read(string $name): array {
    $file = panel_data_path($name);
    if (!is_file($file)) {
        return [];
    }
    $raw = (string) file_get_contents($file);
    $raw = preg_replace('/^<\?php[^\n]*\n/', '', $raw);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function panel_write(string $name, array $data): void {
    $file = panel_data_path($name);
    $body = "<?php http_response_code(404); exit; ?>\n" . json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if (@file_put_contents($file . '.tmp', $body, LOCK_EX) === false || !@rename($file . '.tmp', $file)) {
        throw new RuntimeException('No se pudo guardar en ' . PANEL_DATA_DIR . '. Revisa que la carpeta tenga permisos de escritura.');
    }
    @chmod($file, 0640);
}

function panel_users(): array {
    return panel_read('users');
}

function panel_save_users(array $users): void {
    panel_write('users', $users);
}

// ------------------------------------------------------------------ inicio de sesión con límite de intentos

function panel_client_key(): string {
    return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|encuestas');
}

function panel_locked_minutes(): int {
    $attempts = panel_read('attempts');
    $a = $attempts[panel_client_key()] ?? null;
    if ($a && $a['count'] >= PANEL_MAX_ATTEMPTS) {
        $left = $a['time'] + PANEL_LOCK_MINUTES * 60 - time();
        if ($left > 0) {
            return (int) ceil($left / 60);
        }
    }
    return 0;
}

function panel_register_attempt(bool $success): void {
    $attempts = panel_read('attempts');
    $key = panel_client_key();
    // Limpiar registros viejos.
    foreach ($attempts as $k => $a) {
        if ($a['time'] < time() - 86400) {
            unset($attempts[$k]);
        }
    }
    if ($success) {
        unset($attempts[$key]);
    } else {
        $a = $attempts[$key] ?? ['count' => 0, 'time' => time()];
        if ($a['time'] < time() - PANEL_LOCK_MINUTES * 60) {
            $a = ['count' => 0, 'time' => time()];
        }
        $a['count']++;
        $a['time'] = time();
        $attempts[$key] = $a;
    }
    panel_write('attempts', $attempts);
}

function panel_login(string $username, string $password): ?string {
    if ($m = panel_locked_minutes()) {
        return "Demasiados intentos. Espera $m minutos.";
    }
    $username = strtolower(trim($username));
    $users = panel_users();
    $u = $users[$username] ?? null;
    if (!$u || !password_verify($password, $u['hash'])) {
        panel_register_attempt(false);
        usleep(600000);
        return 'Usuario o contraseña incorrectos.';
    }
    panel_register_attempt(true);
    if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT)) {
        $users[$username]['hash'] = password_hash($password, PASSWORD_DEFAULT);
    }
    $users[$username]['lastlogin'] = time();
    panel_save_users($users);
    panel_session_start();
    session_regenerate_id(true);
    $_SESSION['user'] = $username;
    $_SESSION['last'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return null;
}

// ------------------------------------------------------------------ usuarios

function panel_validate_username(string $username): string {
    $username = strtolower(trim($username));
    if (!preg_match('/^[a-z0-9._@-]{3,60}$/', $username)) {
        throw new InvalidArgumentException('El usuario debe tener entre 3 y 60 caracteres: letras, números, punto, guion o @.');
    }
    return $username;
}

function panel_validate_password(string $password): void {
    if (strlen($password) < 8) {
        throw new InvalidArgumentException('La contraseña debe tener al menos 8 caracteres.');
    }
}

function panel_users_export(): array {
    $out = [];
    foreach (panel_users() as $username => $u) {
        $out[] = [
            'username' => $username,
            'name' => $u['name'] ?? '',
            'role' => $u['role'] ?? 'viewer',
            'lastlogin' => !empty($u['lastlogin']) ? date('d/m/Y H:i', $u['lastlogin']) : '',
        ];
    }
    usort($out, fn($a, $b) => strcmp($a['username'], $b['username']));
    return $out;
}

function panel_admin_count(array $users): int {
    return count(array_filter($users, fn($u) => ($u['role'] ?? '') === 'admin'));
}

// ------------------------------------------------------------------ Moodle

/**
 * Petición HTTP desde el servidor del panel. Envía un User-Agent de navegador: muchos firewalls de hosting
 * (ModSecurity, Imunify360, LiteSpeed) responden 403 a peticiones de servidor que no lo llevan.
 *
 * @return array [código HTTP, cuerpo, cabecera Server, error de conexión]
 */
function panel_http(string $url, ?string $postfields, bool $useragent = true): array {
    $ua = 'Mozilla/5.0 (compatible; PanelEncuestas/1.1; +' . (($_SERVER['HTTP_HOST'] ?? '') ?: 'panel') . ')';
    if (function_exists('curl_init')) {
        $server = '';
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 300,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_POSTREDIR => 3,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_HTTPHEADER => ['Accept: application/json, text/plain, */*'],
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$server) {
                if (stripos($line, 'server:') === 0) {
                    $server = trim(substr($line, 7));
                }
                return strlen($line);
            },
        ];
        if ($useragent) {
            $opts[CURLOPT_USERAGENT] = $ua;
        }
        if ($postfields !== null) {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = $postfields;
            $opts[CURLOPT_HTTPHEADER][] = 'Content-Type: application/x-www-form-urlencoded';
        }
        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        $err = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return [$code, $body === false ? '' : (string) $body, $server, $body === false ? $err : ''];
    }
    $headers = "Accept: application/json, text/plain, */*\r\n" . ($useragent ? "User-Agent: $ua\r\n" : '');
    $http = ['method' => $postfields === null ? 'GET' : 'POST', 'timeout' => 300, 'ignore_errors' => true, 'header' => $headers];
    if ($postfields !== null) {
        $http['header'] .= "Content-Type: application/x-www-form-urlencoded\r\n";
        $http['content'] = $postfields;
    }
    $body = @file_get_contents($url, false, stream_context_create(['http' => $http]));
    $code = 0;
    $server = '';
    foreach (($http_response_header ?? []) as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $code = (int) $m[1];
        } else if (stripos($h, 'server:') === 0) {
            $server = trim(substr($h, 7));
        }
    }
    return [$code, $body === false ? '' : (string) $body, $server, $body === false ? 'No se pudo conectar' : ''];
}

/**
 * Carpeta de Moodle (la que tiene su config.php) si está en este mismo servidor; '' si no se encuentra.
 * MOODLE_PATH = '' -> la busca sola; una ruta -> usa esa; 'off' -> no usar conexión directa.
 */
function panel_moodle_dir(): string {
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $dir = '';
    $setting = defined('MOODLE_PATH') ? trim((string) MOODLE_PATH) : '';
    if (strtolower($setting) === 'off') {
        return $dir;
    }
    foreach ($setting !== '' ? [$setting] : panel_moodle_dir_candidates() as $candidate) {
        $candidate = rtrim($candidate, '/');
        if (panel_is_moodle_dir($candidate)) {
            $dir = $candidate;
            break;
        }
    }
    return $dir;
}

function panel_moodle_dir_candidates(): array {
    $host = strtolower((string) parse_url(MOODLE_URL, PHP_URL_HOST));
    $path = trim((string) parse_url(MOODLE_URL, PHP_URL_PATH), '/');
    $out = [];
    $dir = __DIR__;
    for ($i = 0; $i < 6 && $dir !== '/' && $dir !== '.'; $i++) {
        $dir = dirname($dir);
        foreach ([$host, 'www.' . $host] as $h) {
            if ($h === '' || $h === 'www.') {
                continue;
            }
            foreach (['/public_html', '/htdocs', '/httpdocs', '/www', ''] as $sub) {
                $base = $dir . '/' . $h . $sub;
                $out[] = $path !== '' ? $base . '/' . $path : $base;
            }
        }
        foreach (['/public_html', ''] as $sub) {
            $out[] = $path !== '' ? $dir . $sub . '/' . $path : $dir . $sub;
        }
    }
    return array_values(array_unique($out));
}

function panel_is_moodle_dir(string $dir): bool {
    $file = $dir . '/config.php';
    if (!@is_file($file) || !@is_readable($file)) {
        return false;
    }
    $src = (string) @file_get_contents($file, false, null, 0, 16384);
    return strpos($src, 'wwwroot') !== false && strpos($src, 'setup.php') !== false;
}

function panel_ws_url(): string {
    return rtrim(MOODLE_URL, '/') . '/webservice/rest/server.php';
}

function panel_moodle_call(string $action, array $payload): array {
    if (MOODLE_TOKEN === '' || MOODLE_URL === '') {
        throw new RuntimeException('Falta configurar MOODLE_URL y MOODLE_TOKEN en config.php.');
    }
    $fields = http_build_query([
        'wstoken' => MOODLE_TOKEN,
        'wsfunction' => 'mod_encuestamod_panel_call',
        'moodlewsrestformat' => 'json',
        'action' => $action,
        'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    [$code, $body, $server, $err] = panel_http(panel_ws_url(), $fields);
    if ($err !== '') {
        throw new RuntimeException('No se pudo conectar con Moodle: ' . $err);
    }
    $resp = json_decode($body, true);
    if (is_array($resp) && isset($resp['exception'])) {
        $msg = $resp['message'] ?? 'Error de Moodle';
        if (($resp['errorcode'] ?? '') === 'invalidtoken') {
            $msg = 'Moodle rechazó el token. Genera uno nuevo en Moodle y actualiza config.php.';
        } else if (($resp['errorcode'] ?? '') === 'servicenotavailable' || ($resp['errorcode'] ?? '') === 'enablewsdescription') {
            $msg = 'Los servicios web de Moodle están desactivados. Usa "Conectar panel de encuestas" en Moodle.';
        }
        throw new RuntimeException($msg);
    }
    if ($code === 403) {
        throw new RuntimeException('Moodle respondió 403 (prohibido). O los servicios web / el protocolo REST están ' .
            'desactivados en Moodle, o el firewall del hosting bloquea la conexión. Abre diagnostico.php en este panel ' .
            'para saber cuál de las dos es.');
    }
    if (!is_array($resp) || !isset($resp['json'])) {
        throw new RuntimeException('Respuesta inesperada de Moodle (HTTP ' . $code . '): ' .
            substr(trim(preg_replace('/\s+/', ' ', strip_tags($body))), 0, 250));
    }
    $data = json_decode($resp['json'], true);
    return is_array($data) ? $data : [];
}

/**
 * Código de primera instalación cuando no hay token (conexión directa): se guarda en data/setup.php,
 * que solo puede leer quien tiene acceso a los archivos del servidor.
 */
function panel_setup_secret(): array {
    if (MOODLE_TOKEN !== '') {
        return [MOODLE_TOKEN, 'Token de Moodle (el de config.php)', 'Pega el token que pusiste en <code>config.php</code>.'];
    }
    $data = panel_read('setup');
    if (empty($data['code'])) {
        $data = ['code' => strtoupper(bin2hex(random_bytes(4))), 'created' => time()];
        panel_write('setup', $data);
    }
    return [$data['code'], 'Código de instalación',
        'Ábrelo en el Administrador de archivos del hosting: archivo <code>data/setup.php</code> del panel (última línea, "code").'];
}

function panel_h(?string $s): string {
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function panel_asset(string $file): string {
    $path = __DIR__ . '/assets/' . $file;
    return 'assets/' . $file . '?v=' . (is_file($path) ? filemtime($path) : 1);
}
