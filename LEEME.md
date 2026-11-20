# Panel de encuestas (subdominio)

Es un panel aparte, con usuario y contraseña propios, para ver y administrar las encuestas de módulo de Moodle sin entrar a Moodle. Necesita que el plugin **mod_encuestamod** esté instalado en Moodle.

## Instalación

1. Crea el subdominio, por ejemplo `encuestas.cargodeti.com`, y activa su SSL.
2. Sube el contenido de esta carpeta a la carpeta raíz del subdominio.
3. En `config.php` revisa que `MOODLE_URL` sea la dirección de tu Moodle.
4. Abre `https://encuestas.cargodeti.com/diagnostico.php`:
   - **Conexión directa funcionando**: el panel encontró la carpeta de Moodle en el mismo servidor y habla con él sin pasar por internet. No necesita token, y el firewall o anti-bot del hosting no lo afecta.
   - **Carpeta de Moodle no encontrada**: escribe su ruta en `MOODLE_PATH`, dentro de `config.php`. Es la carpeta que contiene el `config.php` de Moodle; en SiteGround suele ser `/home/customer/www/cargodeti.com/public_html`.
   - **Moodle está en otro servidor**: usa el token. En Moodle entra a Administración del sitio > Cursos > Conectar panel de encuestas, pulsa el botón y copia `MOODLE_TOKEN` en `config.php`.
5. Abre el subdominio y crea el usuario administrador. Para comprobar que eres tú, te pide el token o, si no hay token, el código que aparece en `data/setup.php`; ese archivo se abre con el Administrador de archivos.
6. En la pestaña **Usuarios** crea las demás cuentas:
   - **Administrador**: puede hacer todo.
   - **Solo lectura**: puede mirar, pero no cambiar nada.

## Archivos

- `config.php`: la dirección de Moodle y, opcionalmente, la carpeta de Moodle o el token.
- `moodle-bridge.php`: la conexión directa con Moodle.
- `diagnostico.php`: comprueba la conexión y dice qué falta.
- `data/`: los usuarios del panel. Las contraseñas se guardan cifradas y los archivos no se pueden leer desde la web.
- `assets/`: la aplicación. Es el mismo código que usa el gestor dentro de Moodle.

Requisitos: PHP 7.4 o superior, con la extensión curl (viene en casi todos los hostings).
