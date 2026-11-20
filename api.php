<?php
/**
 * API JSON del panel: usuarios locales + reenvío a Moodle según el rol.
 */
define('PANEL', 1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function panel_respond(array $data): void {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new RuntimeException('Método no permitido.');
    }
    $user = panel_current_user();
    if (!$user) {
        panel_respond(['ok' => false, 'login' => true, 'error' => 'Tu sesión expiró. Vuelve a ingresar.']);
    }
    if (!hash_equals($_SESSION['csrf'] ?? '', $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) {
        throw new RuntimeException('La página caducó. Recárgala e inténtalo de nuevo.');
    }
    // Liberar la sesión para que varias peticiones puedan ir en paralelo.
    session_write_close();

    $req = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $action = (string) ($req['action'] ?? '');
    $payload = is_array($req['payload'] ?? null) ? $req['payload'] : [];
    $isadmin = ($user['role'] ?? '') === 'admin';

    // Usuarios del panel (solo administradores).
    if (strpos($action, 'users_') === 0) {
        if (!$isadmin) {
            throw new RuntimeException('Solo un administrador del panel puede gestionar usuarios.');
        }
        $users = panel_users();
        if ($action === 'users_list') {
            panel_respond(['ok' => true, 'data' => ['users' => panel_users_export()]]);
        }
        if ($action === 'users_save') {
            $isnew = !empty($payload['isnew']);
            $username = panel_validate_username((string) ($payload['username'] ?? ''));
            $role = isset(PANEL_ROLES[$payload['role'] ?? '']) ? $payload['role'] : 'viewer';
            $password = (string) ($payload['password'] ?? '');
            if ($isnew && isset($users[$username])) {
                throw new RuntimeException('Ya existe un usuario con ese nombre.');
            }
            if (!$isnew && !isset($users[$username])) {
                throw new RuntimeException('El usuario no existe.');
            }
            if ($isnew || $password !== '') {
                panel_validate_password($password);
            }
            $old = $users[$username] ?? [];
            $users[$username] = [
                'name' => trim(strip_tags((string) ($payload['name'] ?? ''))),
                'role' => $role,
                'hash' => ($isnew || $password !== '') ? password_hash($password, PASSWORD_DEFAULT) : $old['hash'],
                'lastlogin' => $old['lastlogin'] ?? 0,
                'created' => $old['created'] ?? time(),
            ];
            if (panel_admin_count($users) === 0) {
                throw new RuntimeException('Debe quedar al menos un administrador.');
            }
            panel_save_users($users);
            panel_respond(['ok' => true, 'data' => ['users' => panel_users_export()]]);
        }
        if ($action === 'users_delete') {
            $username = strtolower((string) ($payload['username'] ?? ''));
            if ($username === $user['username']) {
                throw new RuntimeException('No puedes eliminar tu propio usuario.');
            }
            unset($users[$username]);
            if (panel_admin_count($users) === 0) {
                throw new RuntimeException('Debe quedar al menos un administrador.');
            }
            panel_save_users($users);
            panel_respond(['ok' => true, 'data' => ['users' => panel_users_export()]]);
        }
        throw new RuntimeException('Acción no válida.');
    }

    if (in_array($action, PANEL_WRITE_ACTIONS, true)) {
        if (!$isadmin) {
            throw new RuntimeException('Tu usuario es de solo lectura.');
        }
    } else if (!in_array($action, PANEL_READ_ACTIONS, true)) {
        throw new RuntimeException('Acción no válida.');
    }
    if (function_exists('set_time_limit')) {
        @set_time_limit(320);
    }
    if (panel_moodle_dir() !== '') {
        // Conexión directa: Moodle está en este servidor. Se guarda la petición antes de cargar Moodle.
        $GLOBALS['PANEL_REQUEST'] = [$action, $payload];
        require __DIR__ . '/moodle-bridge.php';
        [$panelaction, $panelpayload] = $GLOBALS['PANEL_REQUEST'];
        panel_respond(['ok' => true, 'data' => panel_bridge_call($panelaction, $panelpayload)]);
    }
    panel_respond(['ok' => true, 'data' => panel_moodle_call($action, $payload)]);
} catch (Throwable $e) {
    panel_respond(['ok' => false, 'error' => $e->getMessage()]);
}
