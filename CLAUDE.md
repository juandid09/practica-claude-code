# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Un panel PHP independiente (se publica en un subdominio, por ejemplo `encuestas.cargodeti.com`) para ver y administrar las "encuestas de módulo" de Moodle sin entrar a Moodle. Tiene sus propios usuarios y depende del plugin de Moodle **mod_encuestamod** (no está en este repositorio) para todos los datos de las encuestas. Las instrucciones de instalación para el usuario final están en `LEEME.md`. Los comentarios del código, los textos de la interfaz y los mensajes de error están en español: mantenerlos así.

## Comandos

No hay paso de compilación, gestor de paquetes, configuración de linter ni pruebas. Es PHP 7.4+ (necesita `curl`) más JS/CSS sin dependencias que se sirven tal cual.

- Ejecutar en local: `php -S localhost:8000` desde la raíz del repositorio y abrir `/` (panel) o `/diagnostico.php` (prueba de conexión). El servidor integrado de PHP ignora `.htaccess`, así que en local no se aplican los bloqueos a `config*.php`, `lib.php` y `data/`.
- Revisar sintaxis: `php -l <archivo>.php`
- Si no hay un Moodle en la misma máquina, poner `MOODLE_PATH` en `off` y usar `MOODLE_TOKEN` (o asumir que las llamadas a Moodle fallarán).

## Reglas del proyecto

- Nunca escribir tokens ni rutas reales en `config.php`: van en `config.local.php`, que está en `.gitignore`.
- Nunca leer ni modificar `data/*.php` ni `config.local.php`.
- Después de editar cualquier archivo PHP, validarlo con `php -l <archivo>.php`.
- Commits en español, en ramas `feat/`, y siempre vía PR; nunca directo a `main`.

## Arquitectura

**Puntos de entrada**: cada archivo PHP de entrada hace `define('PANEL', 1)` y luego `require lib.php`. Los demás archivos PHP (`lib.php`, `config.php`, `config.local.php`, `moodle-bridge.php`) responden 404 y se detienen si `PANEL` no está definido; cualquier archivo nuevo que se incluya debe tener esa misma protección.

- `index.php`: creación del primer administrador, formulario de inicio de sesión y estructura de la aplicación. Inyecta `window.ENCUESTAS_CONFIG` (URL de la API, token CSRF, `canedit`/`canusers` según el rol) y carga `assets/panel.js`.
- `api.php`: único endpoint JSON (POST `{action, payload}`, CSRF en la cabecera `X-CSRF-Token`). Las acciones `users_*` se resuelven aquí mismo (solo administradores); todo lo demás se reenvía a Moodle después de comprobarlo contra `PANEL_READ_ACTIONS` / `PANEL_WRITE_ACTIONS` en `lib.php` (las de escritura exigen el rol `admin`). Para agregar una acción nueva de Moodle hay que añadirla a una de esas listas.
- `diagnostico.php`: averigua qué modo de conexión con Moodle funciona y qué falta configurar.

**Dos formas de hablar con Moodle** (`api.php` elige con `panel_moodle_dir()`):
1. *Conexión directa* (la preferida, mismo servidor): `moodle-bridge.php` modifica `$_SERVER` para que Moodle crea que la petición va a su propia dirección, hace `require` del `config.php` de Moodle en el mismo proceso y llama a `\mod_encuestamod\local\service::call($action, $payload)` como administrador del sitio. Debe incluirse desde el ámbito global (el config de Moodle crea variables globales); por eso `api.php` guarda la petición en `$GLOBALS['PANEL_REQUEST']` antes de incluirlo. La carpeta de Moodle se detecta sola con `panel_moodle_dir_candidates()` o se fija con `MOODLE_PATH` (`'off'` la desactiva).
2. *Servicio web* (Moodle en otro servidor): `panel_moodle_call()` hace POST a `webservice/rest/server.php` con `wsfunction=mod_encuestamod_panel_call` y `MOODLE_TOKEN`. `panel_http()` envía a propósito un User-Agent de navegador para pasar los firewalls del hosting.

**Prioridad de la configuración** (`config.php`): las constantes definidas en `config.local.php` (ignorado por git) → las variables de entorno `PANEL_<NOMBRE>` (por ejemplo `PANEL_MOODLE_TOKEN`, `PANEL_MOODLE_PATH`, `PANEL_MOODLE_URL`) → los valores por defecto, mediante `panel_config()`. `config.local.example.php` es la plantilla.

**Almacenamiento**: no hay base de datos. Los usuarios del panel, los contadores de intentos de inicio de sesión y el código de instalación se guardan como JSON en archivos `data/*.php` que empiezan con la línea `<?php http_response_code(404); exit; ?>` para que no se puedan leer desde la web (`panel_read`/`panel_write` en `lib.php`, escritura atómica con `.tmp` + rename). `data/*.php` está en `.gitignore`. Para crear el primer administrador hay que demostrar acceso al servidor escribiendo `MOODLE_TOKEN` o el código de `data/setup.php`.

**Frontend**: `assets/panel.js` es un único IIFE sin dependencias que **se comparte con el plugin de Moodle** (también corre dentro de `mod/encuestamod/manage.php` / `report.php`, donde usa `sesskey` en lugar de `csrf`). Los cambios deben seguir funcionando en ambos lugares; todo el comportamiento depende de `window.ENCUESTAS_CONFIG`. Las URLs de los assets evitan la caché con la fecha de modificación del archivo, mediante `panel_asset()`.
