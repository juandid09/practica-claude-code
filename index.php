<?php
/**
 * Panel de encuestas de módulo (subdominio): inicio de sesión y aplicación.
 */
define('PANEL', 1);
require __DIR__ . '/lib.php';

header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
panel_session_start();

if (isset($_GET['logout'])) {
    panel_logout();
    header('Location: ./');
    exit;
}

$error = '';
$notice = '';
$users = panel_users();
$setup = empty($users);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['csrf'] ?? '', (string) ($_POST['csrf'] ?? ''))) {
        $error = 'La página caducó. Inténtalo de nuevo.';
    } else if ($setup) {
        // Primer administrador: hay que demostrar que se tiene acceso a config.local.php (pegando el token).
        try {
            if ($m = panel_locked_minutes()) {
                throw new RuntimeException("Demasiados intentos. Espera $m minutos.");
            }
            [$secret, $secretlabel] = panel_setup_secret();
            if (!hash_equals(strtoupper($secret), strtoupper(trim((string) ($_POST['token'] ?? ''))))) {
                panel_register_attempt(false);
                throw new RuntimeException('El ' . strtolower($secretlabel) . ' no coincide.');
            }
            $username = panel_validate_username((string) ($_POST['username'] ?? ''));
            $password = (string) ($_POST['password'] ?? '');
            panel_validate_password($password);
            if ($password !== (string) ($_POST['password2'] ?? '')) {
                throw new RuntimeException('Las contraseñas no coinciden.');
            }
            panel_save_users([$username => [
                'name' => trim(strip_tags((string) ($_POST['name'] ?? ''))),
                'role' => 'admin',
                'hash' => password_hash($password, PASSWORD_DEFAULT),
                'lastlogin' => 0,
                'created' => time(),
            ]]);
            panel_login($username, $password);
            header('Location: ./');
            exit;
        } catch (Throwable $e) {
            $error = $e->getMessage();
        }
    } else {
        $err = panel_login((string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));
        if ($err === null) {
            header('Location: ./');
            exit;
        }
        $error = $err;
    }
}

$user = $setup ? null : panel_current_user();
$setupsecret = $setup ? panel_setup_secret() : null;
$csrf = $_SESSION['csrf'];
?><!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= panel_h(PANEL_TITLE) ?></title>
<link rel="stylesheet" href="<?= panel_h(panel_asset('panel.css')) ?>">
<style>
    html, body { margin: 0; background: #f7f8f5; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .top { background: #4a5240; color: #fff; padding: .9rem 1.5rem; display: flex; align-items: center; gap: .75rem; }
    .top strong { font-size: 1.05rem; letter-spacing: .01em; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: #e5803a; display: inline-block; }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 1.25rem 1.5rem 3rem; }
    .login { max-width: 420px; margin: 8vh auto; background: #fff; border: 1px solid #e3e5df; border-radius: 14px; padding: 1.75rem; }
    .login h1 { font-size: 1.35rem; margin: 0 0 .35rem; }
    .login p { color: #667085; margin: 0 0 1.25rem; font-size: .93rem; }
    .login .ea-input { width: 100%; }
    .login .ea-btn { width: 100%; padding: .7rem; margin-top: .25rem; }
</style>
</head>
<body>
<div class="top"><span class="dot"></span><strong><?= panel_h(PANEL_TITLE) ?></strong></div>
<?php if ($setup): ?>
    <div class="ea-root">
    <form class="login" method="post" autocomplete="off">
        <h1>Crear el administrador del panel</h1>
        <p>Es la primera vez que se abre el panel. Para comprobar que eres tú: <?= $setupsecret[2] ?></p>
        <?php if ($error): ?><div class="ea-alert ea-alert-error"><?= panel_h($error) ?></div><?php endif; ?>
        <input type="hidden" name="csrf" value="<?= panel_h($csrf) ?>">
        <label class="ea-field"><span><?= panel_h($setupsecret[1]) ?></span><input class="ea-input" name="token" required autocomplete="off"></label>
        <label class="ea-field"><span>Tu nombre</span><input class="ea-input" name="name" value="<?= panel_h($_POST['name'] ?? '') ?>"></label>
        <label class="ea-field"><span>Usuario</span><input class="ea-input" name="username" required value="<?= panel_h($_POST['username'] ?? '') ?>"></label>
        <label class="ea-field"><span>Contraseña (mínimo 8 caracteres)</span><input class="ea-input" type="password" name="password" required autocomplete="new-password"></label>
        <label class="ea-field"><span>Repite la contraseña</span><input class="ea-input" type="password" name="password2" required autocomplete="new-password"></label>
        <button class="ea-btn ea-btn-primary" type="submit">Crear y entrar</button>
    </form>
    </div>
<?php elseif (!$user): ?>
    <div class="ea-root">
    <form class="login" method="post">
        <h1>Ingresar</h1>
        <p>Panel de encuestas de fin de módulo.</p>
        <?php if ($error): ?><div class="ea-alert ea-alert-error"><?= panel_h($error) ?></div><?php endif; ?>
        <input type="hidden" name="csrf" value="<?= panel_h($csrf) ?>">
        <label class="ea-field"><span>Usuario</span><input class="ea-input" name="username" required autofocus autocomplete="username" value="<?= panel_h($_POST['username'] ?? '') ?>"></label>
        <label class="ea-field"><span>Contraseña</span><input class="ea-input" type="password" name="password" required autocomplete="current-password"></label>
        <button class="ea-btn ea-btn-primary" type="submit">Entrar</button>
    </form>
    </div>
<?php else: ?>
    <div class="wrap">
        <?php if (MOODLE_TOKEN === '' && panel_moodle_dir() === ''): ?>
            <div class="ea-root"><div class="ea-alert ea-alert-error">No se encontró Moodle en este servidor y no hay token en
            config.local.php. Abre <a href="diagnostico.php">diagnostico.php</a>.</div></div>
        <?php endif; ?>
        <div id="encuestas-app"><div class="ea-loading">Cargando…</div></div>
    </div>
    <script>
    window.ENCUESTAS_CONFIG = <?= json_encode([
        'api' => 'api.php',
        'csrf' => $csrf,
        'mode' => 'full',
        'canedit' => ($user['role'] ?? '') === 'admin',
        'canusers' => ($user['role'] ?? '') === 'admin',
        'user' => $user['name'] ?: $user['username'],
        'rolelabel' => PANEL_ROLES[$user['role']] ?? '',
        'logouturl' => '?logout=1',
        'moodleurl' => MOODLE_URL,
    ], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;
    </script>
    <script src="<?= panel_h(panel_asset('panel.js')) ?>"></script>
<?php endif; ?>
</body>
</html>
